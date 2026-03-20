import type { VercelRequest, VercelResponse } from '@vercel/node'
import './instrumentation'
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { langfuseSpanProcessor } from './instrumentation'

const MODEL = 'gemini-3.1-flash-image-preview'
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GEMINI_API_KEY || (req.headers['x-gemini-key'] as string)
  if (!apiKey) {
    return res.status(400).json({ error: 'No API key. Set GEMINI_API_KEY on server or provide your own in Settings.' })
  }

  const { prompt } = req.body || {}
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt field in request body' })
  }

  const sessionId = req.headers['x-session-id'] as string | undefined
  const agentName = req.headers['x-agent-name'] as string | undefined

  try {
    const data = await propagateAttributes(
      { sessionId, traceName: agentName ? `${agentName}-image` : 'gemini-image' },
      () => startActiveObservation('gemini-image-generate', async (generation) => {
        const startMs = Date.now()

        generation.update({
          model: MODEL,
          input: { prompt },
          metadata: { agentName, sessionId },
        })

        const response = await fetch(`${API_URL}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
              temperature: 0.7,
            },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
            ],
          }),
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

        const parts = result?.candidates?.[0]?.content?.parts || []
        let imageData: string | null = null
        let mimeType = 'image/png'
        let caption: string | undefined

        for (const part of parts) {
          if (part.inlineData) {
            imageData = part.inlineData.data
            mimeType = part.inlineData.mimeType || 'image/png'
          } else if (part.text) {
            caption = part.text.trim()
          }
        }

        const hasImage = !!imageData
        const blockReason = result?.promptFeedback?.blockReason

        generation.update({
          output: hasImage ? { hasImage: true, mimeType, caption } : { hasImage: false, blockReason },
          metadata: { agentName, sessionId, latencyMs, hasImage },
        })

        return { ok: true, imageData, mimeType, caption, blockReason }
      }, { asType: 'generation' }),
    )

    await langfuseSpanProcessor.forceFlush()

    if (!data.ok) {
      const errorMessage = data.result?.error?.message || 'Unknown API error'
      const errorCode = data.result?.error?.code || data.status
      console.error(`[gemini-image] API error ${data.status}: ${errorMessage}`)
      return res.status(data.status).json({
        error: errorMessage,
        code: errorCode,
        status: data.status,
      })
    }

    if (!data.imageData) {
      if (data.blockReason) {
        console.error(`[gemini-image] Content blocked: ${data.blockReason}`)
        return res.status(400).json({
          error: `Content blocked by safety filter: ${data.blockReason}`,
          code: 'CONTENT_BLOCKED',
          status: 400,
        })
      }
      return res.status(500).json({
        error: 'No image data in response',
        code: 'NO_IMAGE',
        status: 500,
      })
    }

    return res.status(200).json({ imageData: data.imageData, mimeType: data.mimeType, caption: data.caption })
  } catch (err) {
    console.error('[gemini-image] Request failed:', err)
    return res.status(500).json({
      error: 'Proxy request failed',
      code: 'PROXY_ERROR',
      status: 500,
      detail: String(err),
    })
  }
}
