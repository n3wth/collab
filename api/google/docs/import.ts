import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getGoogleAccessToken, googleFetch, GoogleAuthError } from '../_utils'

// Simple HTML sanitizer — allows only safe tags
const ALLOWED_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'br', 'table', 'tr', 'td', 'th', 'tbody', 'thead'])

function sanitizeHtml(html: string): string {
  // Strip <style> blocks
  let clean = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  // Strip Google's span wrappers but keep content
  clean = clean.replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, '')
  // Strip class/style/id attributes
  clean = clean.replace(/\s+(class|style|id|data-[a-z-]+)="[^"]*"/gi, '')
  // Strip disallowed tags but keep content
  clean = clean.replace(/<\/?(?!(?:p|h[1-6]|strong|em|a|ul|ol|li|br|table|tr|td|th|tbody|thead)\b)[a-z][a-z0-9]*[^>]*>/gi, '')
  return clean.trim()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { userId, fileId } = req.body || {}
  if (!userId || !fileId) {
    return res.status(400).json({ error: 'Missing userId or fileId' })
  }

  try {
    const token = await getGoogleAccessToken(userId)

    // Get file metadata for title
    const metaRes = await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name`,
      token
    )
    const meta = await metaRes.json()
    const title = meta.name || 'Untitled'

    // Export as HTML
    const exportRes = await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/html`,
      token
    )

    if (!exportRes.ok) {
      const err = await exportRes.text()
      console.error('[google/docs/import] Export failed:', err.slice(0, 200))
      return res.status(exportRes.status).json({ error: 'Failed to export document' })
    }

    const rawHtml = await exportRes.text()
    // Extract body content only
    const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)
    const bodyHtml = bodyMatch ? bodyMatch[1] : rawHtml
    const html = sanitizeHtml(bodyHtml)

    return res.status(200).json({ html, title })
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return res.status(401).json({ error: err.message, code: err.code })
    }
    console.error('[google/docs/import] Error:', err)
    return res.status(500).json({ error: 'Document import failed' })
  }
}
