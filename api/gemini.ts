import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { PostHog } from 'posthog-node'
import { agentActionSchema } from '../src/agent-schema'

const langfusePublicKey = (process.env.LANGFUSE_PUBLIC_KEY || '').trim()
const langfuseSecretKey = (process.env.LANGFUSE_SECRET_KEY || '').trim()
const langfuseBaseUrl = (process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com').trim()
const langfuseEnabled = !!(langfusePublicKey && langfuseSecretKey)

let langfuseSpanProcessor: LangfuseSpanProcessor | null = null
if (langfuseEnabled) {
  langfuseSpanProcessor = new LangfuseSpanProcessor({
    publicKey: langfusePublicKey,
    secretKey: langfuseSecretKey,
    baseUrl: langfuseBaseUrl,
  })
  const tracerProvider = new NodeTracerProvider({ spanProcessors: [langfuseSpanProcessor] })
  tracerProvider.register()
}

const posthog = new PostHog(process.env.VITE_PUBLIC_POSTHOG_KEY || '', {
  host: process.env.VITE_PUBLIC_POSTHOG_HOST || 'https://elephant.markup.so',
})

const MODEL_ID = 'gemini-2.5-flash'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GEMINI_API_KEY || (req.headers['x-gemini-key'] as string)
  if (!apiKey) {
    return res.status(400).json({ error: 'No API key. Set GEMINI_API_KEY on server or provide your own in Settings.' })
  }

  const sessionId = req.headers['x-session-id'] as string | undefined
  const userId = req.headers['x-user-id'] as string | undefined
  const agentName = req.headers['x-agent-name'] as string | undefined

  const { prompt } = req.body || {}
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt in request body', code: 'BAD_REQUEST', status: 400 })
  }

  const google = createGoogleGenerativeAI({ apiKey })

  try {
    const callAI = async () => {
      const startMs = Date.now()
      const result = await generateObject({
        model: google(MODEL_ID),
        schema: agentActionSchema,
        prompt,
        temperature: 0.7,
        maxRetries: 3,
        providerOptions: {
          google: {
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
            ],
          },
        },
      })
      const latencyMs = Date.now() - startMs
      return { action: result.object, usage: result.usage, latencyMs }
    }

    let data: Awaited<ReturnType<typeof callAI>>

    if (langfuseEnabled) {
      data = await propagateAttributes(
        { sessionId, userId, traceName: agentName ? `${agentName}-generation` : 'gemini-generation' },
        () => startActiveObservation('gemini-generate', async (generation) => {
          generation.update({ model: MODEL_ID, input: prompt, metadata: { agentName, sessionId } })
          const d = await callAI()
          generation.update({
            output: d.action,
            usageDetails: {
              input: d.usage.inputTokens ?? 0,
              output: d.usage.outputTokens ?? 0,
              total: (d.usage.inputTokens ?? 0) + (d.usage.outputTokens ?? 0),
            },
            metadata: { agentName, sessionId, latencyMs: d.latencyMs },
          })
          return d
        }, { asType: 'generation' }),
      )
      await langfuseSpanProcessor!.forceFlush()
    } else {
      data = await callAI()
    }

    // PostHog LLM analytics
    posthog.capture({
      distinctId: userId || 'anonymous',
      event: '$ai_generation',
      properties: {
        $ai_model: MODEL_ID,
        $ai_provider: 'google',
        $ai_input_tokens: data.usage.inputTokens ?? 0,
        $ai_output_tokens: data.usage.outputTokens ?? 0,
        $ai_latency: data.latencyMs ? data.latencyMs / 1000 : undefined,
        $ai_trace_id: sessionId,
        $ai_is_error: false,
        $ai_stream: false,
        $ai_output: JSON.stringify(data.action).slice(0, 1000),
        agent_name: agentName,
        session_id: sessionId,
      },
    })
    await posthog.flush()

    return res.status(200).json({
      action: data.action,
      usage: {
        input: data.usage.inputTokens ?? 0,
        output: data.usage.outputTokens ?? 0,
      },
    })
  } catch (err) {
    console.error('[gemini-proxy] Request failed:', err)

    // PostHog error tracking
    posthog.capture({
      distinctId: userId || 'anonymous',
      event: '$ai_generation',
      properties: {
        $ai_model: MODEL_ID,
        $ai_provider: 'google',
        $ai_is_error: true,
        $ai_trace_id: sessionId,
        agent_name: agentName,
        session_id: sessionId,
        error: String(err),
      },
    })
    await posthog.flush()

    // Detect rate limiting from AI SDK errors
    const errMsg = err instanceof Error ? err.message : String(err)
    if (errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit')) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT',
        status: 429,
      })
    }

    return res.status(500).json({
      error: 'Proxy request failed',
      code: 'PROXY_ERROR',
      status: 500,
      detail: errMsg,
    })
  }
}
