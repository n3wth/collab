import { useEffect, useRef } from 'react'
import { AGENT_PRESETS } from './AgentConfigurator'
import type { AgentConfig } from './orchestrator'
import type { DocTemplate } from './types'

const AGENT_DESCRIPTIONS: Record<string, string> = {
  Aiden: 'Technical architecture and engineering',
  Nova: 'Product strategy and user research',
  Lex: 'Legal review and compliance',
  Mira: 'Design and user experience',
}

interface Starter {
  id: string
  title: string
  description: string
  template: DocTemplate
  agents: AgentConfig[]
}

export const STARTERS: Starter[] = [
  {
    id: 'blank',
    title: 'Blank Canvas',
    description: 'Empty doc, your choice of agents.',
    template: 'blank',
    agents: [
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
    ],
  },
  {
    id: 'product-brief',
    title: 'Product Brief',
    description: 'Architecture review and user assumption testing.',
    template: 'prd',
    agents: [
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
      { name: 'Nova', persona: AGENT_PRESETS[1].persona, owner: 'You', color: '#ff6961' },
    ],
  },
  {
    id: 'tech-spec',
    title: 'Technical Spec',
    description: 'System design with compliance and risk review.',
    template: 'tech-spec',
    agents: [
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
      { name: 'Lex', persona: AGENT_PRESETS[2].persona, owner: 'You', color: '#64d2ff' },
    ],
  },
  {
    id: 'design-review',
    title: 'Design Review',
    description: 'UX advocacy and product-market fit analysis.',
    template: 'prd',
    agents: [
      { name: 'Mira', persona: AGENT_PRESETS[3].persona, owner: 'You', color: '#ffd60a' },
      { name: 'Nova', persona: AGENT_PRESETS[1].persona, owner: 'You', color: '#ff6961' },
    ],
  },
  {
    id: 'full-team',
    title: 'Full Team',
    description: 'Engineering, product, legal, and design.',
    template: 'prd',
    agents: AGENT_PRESETS.map(p => ({
      name: p.name,
      persona: p.persona,
      owner: 'You',
      color: p.color,
    })),
  },
  {
    id: 'meeting-notes',
    title: 'Meeting Notes',
    description: 'Decision capture and action item extraction.',
    template: 'meeting-notes',
    agents: [
      { name: 'Nova', persona: AGENT_PRESETS[1].persona, owner: 'You', color: '#ff6961' },
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
    ],
  },
]

interface Props {
  onSelect: (starter: Starter) => void
  onClose: () => void
}

export function TemplatePickerModal({ onSelect, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="template-picker-overlay"
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="template-picker">
        <div className="template-picker-header">
          <span className="template-picker-title">New document</span>
          <button className="template-picker-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="template-picker-list">
          {STARTERS.map((s, i) => (
            <button
              key={s.id}
              className={`template-picker-item ${i === 0 ? 'template-picker-item-default' : ''}`}
              onClick={() => onSelect(s)}
            >
              <div className="template-picker-item-info">
                <span className="template-picker-item-name">{s.title}</span>
                <span className="template-picker-item-desc">{s.description}</span>
              </div>
              <div className="template-picker-agents">
                {s.agents.map(a => (
                  <span
                    key={a.name}
                    className="template-picker-agent-tag"
                    style={{ color: a.color, background: `${a.color}1a` }}
                    title={AGENT_DESCRIPTIONS[a.name]}
                  >
                    {a.name}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
