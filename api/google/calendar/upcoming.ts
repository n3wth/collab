import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getGoogleAccessToken, googleFetch, GoogleAuthError } from '../_utils'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const userId = req.query.userId as string
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' })
  }

  try {
    const token = await getGoogleAccessToken(userId)

    const now = new Date()
    const future = new Date(now.getTime() + 48 * 60 * 60 * 1000) // 48 hours

    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      maxResults: '10',
      singleEvents: 'true',
      orderBy: 'startTime',
    })

    const calRes = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      token
    )

    if (!calRes.ok) {
      const err = await calRes.text()
      console.error('[google/calendar] API error:', err.slice(0, 200))
      return res.status(calRes.status).json({ error: 'Calendar API error' })
    }

    const data = await calRes.json()
    const events = (data.items || []).map((e: {
      summary?: string
      start?: { dateTime?: string, date?: string }
      end?: { dateTime?: string, date?: string }
      attendees?: { email: string, displayName?: string }[]
      description?: string
    }) => ({
      title: e.summary || 'Untitled event',
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
      attendees: (e.attendees || []).slice(0, 5).map(a => a.displayName || a.email),
      description: (e.description || '').slice(0, 200),
    }))

    return res.status(200).json({ events })
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return res.status(401).json({ error: err.message, code: err.code })
    }
    console.error('[google/calendar] Error:', err)
    return res.status(500).json({ error: 'Calendar request failed' })
  }
}
