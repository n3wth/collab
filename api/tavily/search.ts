import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'TAVILY_API_KEY not configured' })
  }

  const { query, maxResults = 3 } = req.body || {}
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing query parameter' })
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: Math.min(maxResults, 5),
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error(`[tavily] API error ${response.status}: ${errText.slice(0, 200)}`)
      return res.status(response.status).json({ error: `Tavily API error: ${response.status}` })
    }

    const data = await response.json()
    const results = (data.results || []).map((r: { title: string, url: string, content: string, score: number }) => ({
      title: r.title,
      url: r.url,
      content: r.content?.slice(0, 300) || '',
      score: r.score,
    }))

    return res.status(200).json({ results })
  } catch (err) {
    console.error('[tavily] Request failed:', err)
    return res.status(500).json({ error: 'Search request failed' })
  }
}
