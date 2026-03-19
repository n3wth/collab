import { supabase } from './supabase'

export interface UserSettings {
  gemini_api_key: string | null
}

export async function loadUserSettings(userId: string): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('gemini_api_key')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[settings] load error:', error)
    return { gemini_api_key: null }
  }

  return {
    gemini_api_key: data?.gemini_api_key ?? null,
  }
}

export async function saveGeminiApiKey(userId: string, key: string): Promise<void> {
  const { error } = await supabase
    .from('user_settings')
    .upsert(
      {
        user_id: userId,
        gemini_api_key: key || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )

  if (error) throw error
}
