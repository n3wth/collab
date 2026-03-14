import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
)

interface TokenRecord {
  google_refresh_token: string
  google_scopes: string
}

export async function getGoogleAccessToken(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('user_tokens')
    .select('google_refresh_token')
    .eq('user_id', userId)
    .single()

  if (error || !data?.google_refresh_token) {
    throw new GoogleAuthError('No refresh token found. Please reconnect Google Workspace.', 'google_reauth_required')
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new GoogleAuthError('Google OAuth not configured', 'config_error')
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: data.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    console.error('[google] Token refresh failed:', err)
    throw new GoogleAuthError('Failed to refresh Google token. Please reconnect.', 'google_reauth_required')
  }

  const tokenData = await tokenRes.json()
  return tokenData.access_token
}

export async function googleFetch(url: string, token: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 401) {
    throw new GoogleAuthError('Google token expired', 'google_reauth_required')
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after')
    throw new GoogleAuthError(`Rate limited. Retry after ${retryAfter || '60'}s`, 'rate_limited')
  }

  return res
}

export async function storeRefreshToken(userId: string, refreshToken: string, scopes: string): Promise<void> {
  await supabase
    .from('user_tokens')
    .upsert({
      user_id: userId,
      google_refresh_token: refreshToken,
      google_scopes: scopes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
}

export class GoogleAuthError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'GoogleAuthError'
    this.code = code
  }
}
