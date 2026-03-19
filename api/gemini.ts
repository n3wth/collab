import type { VercelRequest, VercelResponse } from '@vercel/node'

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

  try {
    const response = await fetch(`${API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    })

    const data = await response.json()

    if (!response.ok) {
      const errorMessage = data?.error?.message || 'Unknown API error'
      const errorCode = data?.error?.code || response.status
      console.error(`[gemini-proxy] API error ${response.status}: ${errorMessage}`)
      return res.status(response.status).json({
        error: errorMessage,
        code: errorCode,
        status: response.status,
      })
    }

    // Validate response has expected structure
    const hasContent = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!hasContent) {
      const blockReason = data?.promptFeedback?.blockReason
      if (blockReason) {
        console.error(`[gemini-proxy] Content blocked: ${blockReason}`)
        return res.status(400).json({
          error: `Content blocked by safety filter: ${blockReason}`,
          code: 'CONTENT_BLOCKED',
          status: 400,
        })
      }
      // Still forward — the client handles empty candidates too
    }

    return res.status(200).json(data)
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
