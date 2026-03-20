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

// Shared agent config used across orchestrator, configurator, and UI
export interface AgentConfig {
  name: string
  persona: string
  owner: string
  color: string
  description?: string
}

// Chat message as rendered in the UI
export interface DocChange {
  type: 'insert' | 'replace' | 'delete'
  summary: string
  added?: string
  removed?: string
}

export interface Proposal {
  type: 'create-doc' | 'delete-doc' | 'add-agent' | 'remove-agent'
  description: string
  status: 'pending' | 'approved' | 'rejected'
}

export interface Message {
  id: string
  from: string
  text: string
  time: string
  showDocButton?: boolean
  reasoning?: string[]
  docChange?: DocChange
  proposal?: Proposal
}

export interface AgentState {
  status: 'idle' | 'thinking' | 'typing' | 'reading' | 'editing'
  thought?: string
  inDoc: boolean
}

export interface TimelineEntry {
  id: string
  color: string
  tooltip: string
}
