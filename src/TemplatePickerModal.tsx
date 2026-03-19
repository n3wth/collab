import { useEffect, useRef } from 'react'
import { BlobAvatar } from './blob-avatar'
import { AGENT_PRESETS } from './AgentConfigurator'
import type { AgentConfig } from './orchestrator'
import type { DocTemplate } from './types'

interface Starter {
  id: string
  title: string
  description: string
  template: DocTemplate
  agents: AgentConfig[]
}

export const STARTERS: Starter[] = [
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
  {
    id: 'blank',
    title: 'Blank Canvas',
    description: 'Empty doc, your choice of agents.',
    template: 'blank',
    agents: [
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
        <h2 className="template-picker-title">New document</h2>
        <div className="template-picker-grid">
          {STARTERS.map(s => (
            <button
              key={s.id}
              className="template-picker-card"
              onClick={() => onSelect(s)}
            >
              <div className="template-picker-strip">
                {s.agents.map(a => (
                  <BlobAvatar key={a.name} name={a.name} size={18} state="idle" color={a.color} />
                ))}
              </div>
              <div className="template-picker-body">
                <span className="template-picker-name">{s.title}</span>
                <span className="template-picker-desc">{s.description}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
