import { supabase } from './supabase'
import type {
  Session,
  DocTemplate,
  AgentPersonaRecord,
  ChatMessageRecord,
} from '../types'

/* Sessions */

export async function createSession(
  title: string,
  template: DocTemplate,
): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ title, template })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listSessions(): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data || []
}

export async function getSession(id: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  return data
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', id)
  if (error) throw error
}

/* Documents */

export async function saveDocument(
  sessionId: string,
  html: string,
): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .upsert(
      {
        session_id: sessionId,
        html_snapshot: html,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' },
    )
  if (error) throw error
}

export async function loadDocument(
  sessionId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('html_snapshot')
    .eq('session_id', sessionId)
    .single()
  if (error || !data) return null
  return data.html_snapshot
}

/* Chat Messages */

export async function saveChatMessage(
  sessionId: string,
  msg: { sender: string; text: string; reasoning?: string[] },
): Promise<ChatMessageRecord> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      sender: msg.sender,
      text: msg.text,
      reasoning: msg.reasoning || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function loadChatMessages(
  sessionId: string,
): Promise<ChatMessageRecord[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/* Agent Personas */

export async function saveAgentPersonas(
  sessionId: string,
  personas: Omit<AgentPersonaRecord, 'id' | 'session_id'>[],
): Promise<void> {
  await supabase
    .from('agent_personas')
    .delete()
    .eq('session_id', sessionId)

  if (personas.length === 0) return

  const rows = personas.map((p, i) => ({
    session_id: sessionId,
    name: p.name,
    description: p.description,
    system_prompt: p.system_prompt,
    color: p.color,
    owner: p.owner,
    model: p.model,
    sort_order: i,
  }))
  const { error } = await supabase.from('agent_personas').insert(rows)
  if (error) throw error
}

export async function loadAgentPersonas(
  sessionId: string,
): Promise<AgentPersonaRecord[]> {
  const { data, error } = await supabase
    .from('agent_personas')
    .select('*')
    .eq('session_id', sessionId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}
