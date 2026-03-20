import { BlobAvatar } from '../blob-avatar'
import { AgentHoverCard } from './AgentHoverCard'
import { AgentConfigurator } from '../AgentConfigurator'
import { AGENT_DESCRIPTIONS } from './AgentHoverCard'
import { saveAgentPersonas } from '../lib/session-store'
import type { AgentConfig, AgentState, Session } from '../types'

interface SessionHeaderProps {
  activeSession: Session
  activeAgents: AgentConfig[]
  getAgentState: (name: string) => AgentState
  agentsPaused: boolean
  onTogglePause: () => void
  chatWidth: number
  saveStatus: 'saved' | 'saving' | 'idle'
  showConfigurator: boolean
  onToggleConfigurator: () => void
  onAgentsChange: (agents: AgentConfig[]) => void
  activeSessionRef: React.RefObject<Session | null>
}

function agentConfigsToPersonas(agents: AgentConfig[]) {
  return agents.map(a => ({
    name: a.name,
    description: a.persona.split('.')[0].replace(/^You are \w+, /, ''),
    system_prompt: a.persona,
    color: a.color,
    owner: a.owner,
    model: 'gemini-2.5-flash',
    sort_order: 0,
  }))
}

export { agentConfigsToPersonas }

export function SessionHeader({
  activeSession,
  activeAgents,
  getAgentState,
  agentsPaused,
  onTogglePause,
  chatWidth,
  saveStatus,
  showConfigurator,
  onToggleConfigurator,
  onAgentsChange,
  activeSessionRef,
}: SessionHeaderProps) {
  return (
    <>
      <div className="app-header">
        <div className="header-editor-zone">
          <span className="header-doc-title">{activeSession.title}</span>
          {saveStatus === 'saving' && <span className="header-save-status">Saving...</span>}
          {saveStatus === 'saved' && <span className="header-save-status saved">Saved</span>}
        </div>
        <div className="header-chat-zone" style={{ width: chatWidth + 4 }}>
          <button
            className={`header-pause-btn ${agentsPaused ? 'paused' : ''}`}
            onClick={onTogglePause}
            title={agentsPaused ? 'Resume agents' : 'Pause agents'}
            aria-label={agentsPaused ? 'Resume agents' : 'Pause agents'}
          >
            {agentsPaused ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                <polygon points="6,4 20,12 6,20" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                <rect x="5" y="4" width="5" height="16" rx="1" />
                <rect x="14" y="4" width="5" height="16" rx="1" />
              </svg>
            )}
          </button>
          <div className="header-participants">
            {activeAgents.map((agent, idx) => {
              const agentState = getAgentState(agent.name)
              return (
                <div key={agent.name} className="header-avatar-wrap">
                  <BlobAvatar name={agent.name} size={18} state={agentState.status} />
                  <AgentHoverCard
                    name={agent.name}
                    agentState={agentState}
                    agentConfig={agent}
                    onRemove={activeAgents.length > 1 ? () => {
                      const updated = activeAgents.filter((_, i) => i !== idx)
                      onAgentsChange(updated)
                      if (activeSessionRef.current) {
                        saveAgentPersonas(activeSessionRef.current.id, agentConfigsToPersonas(updated))
                          .catch(err => console.error('[App] saveAgentPersonas error:', err))
                      }
                    } : undefined}
                  />
                </div>
              )
            })}
            {activeAgents.length < 4 && (
              <button
                className="header-add-agent"
                onClick={onToggleConfigurator}
                title="Add agent"
                aria-label="Add agent"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
      {showConfigurator && (
        <div className="configurator-panel">
          <AgentConfigurator
            agents={activeAgents.map(a => {
              const preset = AGENT_DESCRIPTIONS[a.name]
              return {
                name: a.name,
                description: preset || a.persona.split('.')[0].replace(/^You are \w+, /, ''),
                persona: a.persona,
                owner: a.owner,
                color: a.color,
              }
            })}
            onChange={(configs) => {
              const updated = configs.map(c => ({
                name: c.name,
                persona: c.persona,
                owner: c.owner,
                color: c.color,
              }))
              onAgentsChange(updated)
              if (activeSessionRef.current) {
                saveAgentPersonas(activeSessionRef.current.id, agentConfigsToPersonas(updated))
                  .catch(err => console.error('[App] saveAgentPersonas error:', err))
              }
            }}
          />
        </div>
      )}
    </>
  )
}
