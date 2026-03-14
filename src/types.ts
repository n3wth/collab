export type DocTemplate = 'blank' | 'prd' | 'tech-spec' | 'meeting-notes' | 'demo-prd'

export interface Session {
  id: string
  title: string
  template: DocTemplate
  created_at: string
  updated_at: string
}

export interface AgentPersonaRecord {
  id: string
  session_id: string
  name: string
  description: string
  system_prompt: string
  color: string
  owner: string
  model: string
  sort_order: number
}

export interface ChatMessageRecord {
  id: string
  session_id: string
  sender: string
  text: string
  reasoning?: string[]
  created_at: string
}

export interface DocumentRecord {
  id: string
  session_id: string
  html_snapshot: string | null
  updated_at: string
}
