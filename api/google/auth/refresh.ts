import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getGoogleAccessToken, GoogleAuthError } from '../_utils'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { userId } = req.body || {}
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' })
  }

  try {
    const accessToken = await getGoogleAccessToken(userId)
    return res.status(200).json({ accessToken })
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return res.status(401).json({ error: err.message, code: err.code })
    }
    console.error('[google/auth/refresh] Error:', err)
    return res.status(500).json({ error: 'Token refresh failed' })
  }
}
