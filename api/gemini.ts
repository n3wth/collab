import type { VercelRequest, VercelResponse } from '@vercel/node'
import './instrumentation'
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { langfuseSpanProcessor } from './instrumentation'

const MODEL = 'gemini-2.5-flash'
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

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

  try {
    const data = await propagateAttributes(
      { sessionId, userId, traceName: agentName ? `${agentName}-generation` : 'gemini-generation' },
      () => startActiveObservation('gemini-generate', async (generation) => {
        const startMs = Date.now()

        generation.update({
          model: MODEL,
          input: req.body,
          metadata: { agentName, sessionId },
        })

        const response = await fetch(`${API_URL}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        })

        const result = await response.json()
        const latencyMs = Date.now() - startMs

        if (!response.ok) {
          generation.update({
            output: result,
            level: 'ERROR',
            statusMessage: result?.error?.message || `API error ${response.status}`,
            metadata: { agentName, sessionId, latencyMs, httpStatus: response.status },
          })
          return { ok: false, status: response.status, result }
        }

        const outputText = result?.candidates?.[0]?.content?.parts?.[0]?.text
        const usage = result?.usageMetadata

        generation.update({
          output: outputText || result,
          usageDetails: usage ? {
            input: usage.promptTokenCount ?? 0,
            output: usage.candidatesTokenCount ?? 0,
            total: usage.totalTokenCount ?? 0,
          } : undefined,
          metadata: { agentName, sessionId, latencyMs },
        })

        return { ok: true, status: 200, result }
      }, { asType: 'generation' }),
    )

    await langfuseSpanProcessor.forceFlush()

    if (!data.ok) {
      const errorMessage = data.result?.error?.message || 'Unknown API error'
      const errorCode = data.result?.error?.code || data.status
      console.error(`[gemini-proxy] API error ${data.status}: ${errorMessage}`)
      return res.status(data.status).json({
        error: errorMessage,
        code: errorCode,
        status: data.status,
      })
    }

    // Validate response has expected structure
    const hasContent = data.result?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!hasContent) {
      const blockReason = data.result?.promptFeedback?.blockReason
      if (blockReason) {
        console.error(`[gemini-proxy] Content blocked: ${blockReason}`)
        return res.status(400).json({
          error: `Content blocked by safety filter: ${blockReason}`,
          code: 'CONTENT_BLOCKED',
          status: 400,
        })
      }
      // Still forward -- the client handles empty candidates too
    }

    return res.status(200).json(data.result)
  } catch (err) {
    console.error('[gemini-proxy] Request failed:', err)
    return res.status(500).json({
      error: 'Proxy request failed',
      code: 'PROXY_ERROR',
      status: 500,
      detail: String(err),
    })
  }
}
