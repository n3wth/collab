import { useState, useEffect, useRef } from 'react'
import { BlobAvatar } from './blob-avatar'
import { listSessions, createSession, deleteSession } from './lib/session-store'
import { DOC_TEMPLATES } from './templates'
import type { Session, DocTemplate } from './types'
import type { AgentConfig } from './orchestrator'
import { AGENT_PRESETS } from './AgentConfigurator'

const AGENT_ROLES: Record<string, string> = {
  Aiden: 'Engineering',
  Nova: 'Product',
  Lex: 'Legal',
  Mira: 'Design',
}

interface Starter {
  id: string
  title: string
  description: string
  template: DocTemplate
  agents: AgentConfig[]
}

const STARTERS: Starter[] = [
  {
    id: 'product-brief',
    title: 'Product Brief',
    description: 'Aiden on architecture, Nova on user assumptions.',
    template: 'prd',
    agents: [
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
      { name: 'Nova', persona: AGENT_PRESETS[1].persona, owner: 'You', color: '#ff6961' },
    ],
  },
  {
    id: 'tech-spec',
    title: 'Technical Spec',
    description: 'Aiden on system design, Lex on risks and compliance.',
    template: 'tech-spec',
    agents: [
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
      { name: 'Lex', persona: AGENT_PRESETS[2].persona, owner: 'You', color: '#64d2ff' },
    ],
  },
  {
    id: 'design-review',
    title: 'Design Review',
    description: 'Mira advocates for users. Nova grounds decisions in adoption data.',
    template: 'prd',
    agents: [
      { name: 'Mira', persona: AGENT_PRESETS[3].persona, owner: 'You', color: '#ffd60a' },
      { name: 'Nova', persona: AGENT_PRESETS[1].persona, owner: 'You', color: '#ff6961' },
    ],
  },
  {
    id: 'full-team',
    title: 'Full Team',
    description: 'All four agents. Engineering, product, legal, and design perspectives.',
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
    description: 'Nova captures decisions. Aiden extracts action items and next steps.',
    template: 'meeting-notes',
    agents: [
      { name: 'Nova', persona: AGENT_PRESETS[1].persona, owner: 'You', color: '#ff6961' },
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
    ],
  },
  {
    id: 'blank',
    title: 'Blank Canvas',
    description: 'Start empty. Pick your own agents and template.',
    template: 'blank',
    agents: [
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
    ],
  },
]

interface Props {
  onSelect: (session: Session, agents: AgentConfig[]) => void
  onSignOut?: () => void
}

type BlobState = 'idle' | 'thinking' | 'reading' | 'typing' | 'editing'

// Choreographed state sequences — each agent has its own rhythm
const CHOREO: { states: BlobState[], durations: number[] }[] = [
  // Aiden: thinks, then types, then idles, then reads
  { states: ['idle', 'thinking', 'typing', 'idle', 'reading', 'idle'], durations: [2200, 1800, 2400, 1600, 2000, 2000] },
  // Nova: reads first, then thinks, types
  { states: ['idle', 'reading', 'thinking', 'idle', 'typing', 'idle'], durations: [1400, 2000, 1600, 2200, 2600, 2200] },
  // Lex: deliberate — long thinking, short typing
  { states: ['idle', 'idle', 'thinking', 'thinking', 'typing', 'idle'], durations: [2600, 1200, 2400, 1400, 1800, 2600] },
  // Mira: reactive — reads, quickly types, thinks after
  { states: ['idle', 'reading', 'typing', 'idle', 'thinking', 'idle'], durations: [1800, 1600, 2200, 2000, 1800, 2600] },
]

function useHeroBlobStates() {
  const [states, setStates] = useState<BlobState[]>(['idle', 'idle', 'idle', 'idle'])
  const timers = useRef<number[]>([])

  useEffect(() => {
    function runAgent(idx: number) {
      const choreo = CHOREO[idx]
      let step = 0

      function tick() {
        setStates(prev => {
          const next = [...prev]
          next[idx] = choreo.states[step]
          return next
        })
        step = (step + 1) % choreo.states.length
        timers.current[idx] = window.setTimeout(tick, choreo.durations[step])
      }

      // Stagger start
      timers.current[idx] = window.setTimeout(tick, idx * 800)
    }

    for (let i = 0; i < 4; i++) runAgent(i)

    return () => {
      timers.current.forEach(t => clearTimeout(t))
    }
  }, [])

  return states
}

export function HomePage({ onSelect, onSignOut }: Props) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const blobStates = useHeroBlobStates()

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleStarter = async (starter: Starter) => {
    const session = await createSession(starter.title, starter.template)
    onSelect(session, starter.agents)
  }

  const handleResumeSession = (session: Session) => {
    onSelect(session, [])
  }

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await deleteSession(id)
    setSessions(s => s.filter(x => x.id !== id))
  }

  return (
    <div className="home">
      <div className="home-inner">
        {onSignOut && (
          <div className="home-topbar">
            <button className="signout-btn" onClick={onSignOut}>Sign out</button>
          </div>
        )}
        <header className="home-hero">
          <div className="home-blobs">
            {AGENT_PRESETS.map((p, i) => (
              <div key={p.name} className="home-blob" style={{ animationDelay: `${i * 150}ms` }}>
                <BlobAvatar name={p.name} size={48} state={blobStates[i]} color={p.color} />
                <span className="home-blob-name">{p.name}</span>
                <span className="home-blob-role">{AGENT_ROLES[p.name]}</span>
              </div>
            ))}
          </div>
          <h1 className="home-title">Collab</h1>
          <p className="home-subtitle">
            AI agents that write, review, and debate your documents in real time.
            Each agent brings a different lens. You stay in control.
          </p>
        </header>

        <section className="home-starters">
          <h2 className="home-section-label">Start a session</h2>
          <div className="home-starter-grid">
            {STARTERS.map((s, i) => (
              <button
                key={s.id}
                className="home-starter-card"
                onClick={() => handleStarter(s)}
                style={{ animationDelay: `${200 + i * 80}ms` }}
              >
                <div className="home-starter-strip">
                  {s.agents.map(a => (
                    <BlobAvatar key={a.name} name={a.name} size={22} state="idle" color={a.color} />
                  ))}
                </div>
                <div className="home-starter-body">
                  <span className="home-starter-title">{s.title}</span>
                  <span className="home-starter-desc">{s.description}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {!loading && sessions.length > 0 && (
          <section className="home-recent">
            <h2 className="home-section-label">Recent sessions</h2>
            <div className="home-recent-list">
              {sessions.slice(0, 5).map(s => (
                <button
                  key={s.id}
                  className="home-recent-item"
                  onClick={() => handleResumeSession(s)}
                >
                  <span className="home-recent-title">{s.title}</span>
                  <span className="home-recent-meta">
                    <span className="home-recent-template">{DOC_TEMPLATES[s.template]?.label ?? s.template}</span>
                    <span className="home-recent-date">{new Date(s.updated_at).toLocaleDateString()}</span>
                    <span
                      className="home-recent-delete"
                      onClick={e => handleDeleteSession(e, s.id)}
                    >
                      Remove
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
