import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getGoogleAccessToken, googleFetch, GoogleAuthError } from '../_utils'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const userId = req.query.userId as string
  const q = req.query.q as string
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' })
  }

  try {
    const token = await getGoogleAccessToken(userId)

    const searchQuery = q || ''
    const params = new URLSearchParams({
      q: `mimeType='application/vnd.google-apps.document' and fullText contains '${searchQuery.replace(/'/g, "\\'")}'`,
      fields: 'files(id,name,modifiedTime,description)',
      orderBy: 'modifiedTime desc',
      pageSize: '5',
    })

    const driveRes = await googleFetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      token
    )

    if (!driveRes.ok) {
      const err = await driveRes.text()
      console.error('[google/drive] API error:', err.slice(0, 200))
      return res.status(driveRes.status).json({ error: 'Drive API error' })
    }

    const data = await driveRes.json()
    const files = (data.files || []).map((f: {
      id: string
      name: string
      modifiedTime: string
      description?: string
    }) => ({
      id: f.id,
      title: f.name,
      modifiedTime: f.modifiedTime,
      snippet: (f.description || '').slice(0, 100),
    }))

    return res.status(200).json({ files })
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return res.status(401).json({ error: err.message, code: err.code })
    }
    console.error('[google/drive] Error:', err)
    return res.status(500).json({ error: 'Drive request failed' })
  }
}
