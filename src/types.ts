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

export interface SearchResult {
  title: string
  url: string
  content: string
  score: number
}

export interface OrchestratorLimits {
  maxTurns: number
  maxExchanges: number
  maxConsecutiveFailures: number
  heartbeatDelayMs: [number, number]
  reactionDelayMs: [number, number]
}

export const DEFAULT_LIMITS: OrchestratorLimits = {
  maxTurns: 4,
  maxExchanges: 4,
  maxConsecutiveFailures: 3,
  heartbeatDelayMs: [20000, 30000],
  reactionDelayMs: [3000, 5000],
}
