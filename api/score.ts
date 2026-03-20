import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ScoreManager } from '@langfuse/client'

let scoreManager: ScoreManager | null = null

function getScoreManager(): ScoreManager | null {
  if (scoreManager) return scoreManager
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  if (!publicKey || !secretKey) return null
  scoreManager = new ScoreManager({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com',
  })
  return scoreManager
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const manager = getScoreManager()
  if (!manager) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'Langfuse not configured' })
  }

  const { traceId, observationId, sessionId, name, value, dataType, comment } = req.body || {}

  if (!name || value === undefined) {
    return res.status(400).json({ error: 'Missing required fields: name, value' })
  }

  try {
    manager.create({
      name,
      value,
      ...(traceId && { traceId }),
      ...(observationId && { observationId }),
      ...(sessionId && { sessionId }),
      ...(dataType && { dataType }),
      ...(comment && { comment }),
    })

    await manager.flush()
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[score] Failed to submit score:', err)
    return res.status(500).json({ error: 'Failed to submit score', detail: String(err) })
  }
}
