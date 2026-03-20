import { BlobAvatar } from '../blob-avatar'
import type { AgentState, AgentConfig } from '../types'

const AGENT_DESCRIPTIONS: Record<string, string> = {
  Aiden: 'Technical architecture and engineering. Writes specs, system design, and implementation details.',
  Nova: 'Product strategy and user research. Identifies gaps, frames adoption risks, and grounds ideas in user needs.',
  Lex: 'Legal and compliance review. Flags risks, regulatory concerns, and contractual implications.',
  Mira: 'Design and user experience. Advocates for users, evaluates usability, and proposes interface patterns.',
}

export { AGENT_DESCRIPTIONS }

export function AgentHoverCard({ name, agentState, agentConfig, onRemove }: { name: string, agentState: AgentState | null, agentConfig?: AgentConfig, onRemove?: () => void }) {
  const desc = AGENT_DESCRIPTIONS[name] || agentConfig?.persona?.split('.')[0]?.replace(/^You are \w+, /, '') || 'AI agent'

  return (
    <div className="agent-hover-card">
      <div className="agent-hover-card-header">
        <BlobAvatar name={name} size={28} state={agentState?.status} />
        <div>
          <div className="agent-hover-card-name">{name}</div>
          <span className="agent-hover-card-model">gemini-2.5-flash</span>
        </div>
      </div>
      <div className="agent-hover-card-desc">{desc}</div>
      <div className="agent-hover-card-divider" />
      <div className="agent-hover-card-status">
        <span className={`agent-hover-card-dot ${agentState?.status !== 'idle' ? 'active' : ''}`} />
        {agentState?.status === 'idle' ? 'Idle' : agentState?.thought || agentState?.status}
        {agentState?.inDoc && <span className="agent-hover-card-location">In document</span>}
      </div>
      {onRemove && (
        <>
          <div className="agent-hover-card-divider" />
          <button className="agent-hover-card-remove" onClick={onRemove}>Remove agent</button>
        </>
      )}
    </div>
  )
}
