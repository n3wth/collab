import { getStoredApiKey } from '../AgentConfigurator'

export async function generateImage(prompt: string): Promise<{ dataUrl: string, caption?: string } | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = getStoredApiKey()
  if (apiKey) headers['X-Gemini-Key'] = apiKey

  try {
    const res = await fetch('/api/gemini-image', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt }),
    })

    if (!res.ok) {
      console.error('[image-gen] API error:', res.status)
      return null
    }

    const data = await res.json()
    if (!data.imageData) return null

    return {
      dataUrl: `data:${data.mimeType};base64,${data.imageData}`,
      caption: data.caption,
    }
  } catch (err) {
    console.error('[image-gen] Request failed:', err)
    return null
  }
}
