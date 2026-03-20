import type { VercelRequest, VercelResponse } from '@vercel/node'

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

  try {
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

    const data = await response.json()

    if (!response.ok) {
      const errorMessage = data?.error?.message || 'Unknown API error'
      const errorCode = data?.error?.code || response.status
      console.error(`[gemini-image] API error ${response.status}: ${errorMessage}`)
      return res.status(response.status).json({
        error: errorMessage,
        code: errorCode,
        status: response.status,
      })
    }

    const parts = data?.candidates?.[0]?.content?.parts || []

    // Extract image and optional text caption from response parts
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

    if (!imageData) {
      const blockReason = data?.promptFeedback?.blockReason
      if (blockReason) {
        console.error(`[gemini-image] Content blocked: ${blockReason}`)
        return res.status(400).json({
          error: `Content blocked by safety filter: ${blockReason}`,
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

    return res.status(200).json({ imageData, mimeType, caption })
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
