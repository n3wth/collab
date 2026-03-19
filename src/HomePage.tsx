import { useState, useEffect } from 'react'
import { BlobAvatar } from './blob-avatar'
import { listSessions, createSession, deleteSession } from './lib/session-store'
import { DOC_TEMPLATES } from './templates'
import type { Session, DocTemplate } from './types'
import type { AgentConfig } from './orchestrator'
import { AGENT_PRESETS } from './AgentConfigurator'
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
    description: 'Engineering, product, legal, and design perspectives.',
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

const DEMO_STARTER: Starter = {
  id: 'demo-prd',
  title: 'Demo: Product Brief Review',
  description: 'Watch agents stress-test a flawed PRD.',
  template: 'demo-prd' as DocTemplate,
  agents: [
    { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
    { name: 'Nova', persona: AGENT_PRESETS[1].persona, owner: 'You', color: '#ff6961' },
  ],
}

interface Props {
  onSelect: (session: Session, agents: AgentConfig[]) => void
  onSignOut?: () => void
  demoMode?: boolean
  onDemoConsumed?: () => void
}

type BlobState = 'idle' | 'thinking' | 'reading' | 'typing' | 'editing'

type Beat = {
  duration: number
  states: [BlobState, BlobState, BlobState, BlobState]
  speech?: { agent: number, line: string }
}

const STORY_TIMELINES: Beat[][] = [
  [
    { duration: 2000, states: ['reading', 'idle', 'idle', 'idle'] },
    { duration: 2400, states: ['thinking', 'idle', 'idle', 'idle'], speech: { agent: 0, line: 'This endpoint needs pagination.' } },
    { duration: 2800, states: ['typing', 'reading', 'idle', 'idle'], speech: { agent: 0, line: 'Adding cursor-based pagination...' } },
    { duration: 2200, states: ['idle', 'thinking', 'idle', 'reading'], speech: { agent: 1, line: 'Will users understand cursors?' } },
    { duration: 2400, states: ['idle', 'idle', 'thinking', 'idle'], speech: { agent: 2, line: 'Rate limits need documenting.' } },
    { duration: 2600, states: ['reading', 'idle', 'typing', 'thinking'], speech: { agent: 3, line: 'Simplifying the query params...' } },
    { duration: 2400, states: ['idle', 'typing', 'idle', 'idle'], speech: { agent: 1, line: 'Default to 20 items per page.' } },
    { duration: 2200, states: ['idle', 'idle', 'typing', 'idle'], speech: { agent: 2, line: 'Added rate limit disclosure.' } },
    { duration: 2000, states: ['idle', 'idle', 'idle', 'thinking'], speech: { agent: 3, line: 'What if we add a loading state?' } },
    { duration: 1800, states: ['idle', 'idle', 'idle', 'idle'] },
  ],
  [
    { duration: 1800, states: ['reading', 'idle', 'idle', 'idle'] },
    { duration: 2400, states: ['thinking', 'idle', 'idle', 'idle'], speech: { agent: 0, line: 'Token refresh is missing.' } },
    { duration: 2800, states: ['typing', 'idle', 'idle', 'reading'], speech: { agent: 0, line: 'Adding refresh token flow...' } },
    { duration: 2200, states: ['idle', 'thinking', 'reading', 'idle'], speech: { agent: 1, line: 'Users hate re-logging in.' } },
    { duration: 2400, states: ['idle', 'idle', 'thinking', 'idle'], speech: { agent: 2, line: 'Tokens must expire in 24h.' } },
    { duration: 2600, states: ['idle', 'idle', 'idle', 'typing'], speech: { agent: 3, line: 'Session indicator in the nav...' } },
    { duration: 2400, states: ['reading', 'typing', 'idle', 'idle'], speech: { agent: 1, line: 'Silent refresh, no interruption.' } },
    { duration: 2200, states: ['idle', 'idle', 'typing', 'idle'], speech: { agent: 2, line: 'Need consent for persistent login.' } },
    { duration: 2000, states: ['idle', 'idle', 'idle', 'thinking'], speech: { agent: 3, line: 'Toast on session extension?' } },
    { duration: 1800, states: ['idle', 'idle', 'idle', 'idle'] },
  ],
  [
    { duration: 2000, states: ['reading', 'idle', 'idle', 'idle'] },
    { duration: 2200, states: ['thinking', 'idle', 'idle', 'idle'], speech: { agent: 0, line: 'No retry on failed ingestion.' } },
    { duration: 2800, states: ['typing', 'reading', 'idle', 'idle'], speech: { agent: 0, line: 'Adding exponential backoff...' } },
    { duration: 2400, states: ['idle', 'thinking', 'idle', 'reading'], speech: { agent: 1, line: 'How do users know it failed?' } },
    { duration: 2200, states: ['idle', 'idle', 'thinking', 'idle'], speech: { agent: 2, line: 'Data retention is 90 days max.' } },
    { duration: 2600, states: ['idle', 'idle', 'idle', 'typing'], speech: { agent: 3, line: 'Error state needs a clear CTA...' } },
    { duration: 2400, states: ['idle', 'typing', 'idle', 'idle'], speech: { agent: 1, line: 'Email notification on failure.' } },
    { duration: 2200, states: ['idle', 'idle', 'typing', 'reading'], speech: { agent: 2, line: 'PII must be masked in logs.' } },
    { duration: 2000, states: ['idle', 'idle', 'idle', 'thinking'], speech: { agent: 3, line: 'Progress bar for large imports?' } },
    { duration: 1800, states: ['idle', 'idle', 'idle', 'idle'] },
  ],
]

function useHeroTimeline(gated: boolean) {
  const [states, setStates] = useState<BlobState[]>(['idle', 'idle', 'idle', 'idle'])

  useEffect(() => {
    if (gated) return

    let arcIndex = 0
    let beatIndex = 0
    let timer: number

    function playBeat() {
      const arc = STORY_TIMELINES[arcIndex % STORY_TIMELINES.length]
      const beat = arc[beatIndex]
      setStates([...beat.states])

      beatIndex++
      if (beatIndex >= arc.length) {
        beatIndex = 0
        arcIndex++
      }
      timer = window.setTimeout(playBeat, beat.duration)
    }

    timer = window.setTimeout(playBeat, 800)
    return () => clearTimeout(timer)
  }, [gated])

  return { states }
}

export function HomePage({ onSelect, onSignOut, demoMode, onDemoConsumed }: Props) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const { states: blobStates } = useHeroTimeline(false)

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (demoMode) {
      onDemoConsumed?.()
      handleStarter(DEMO_STARTER)
    }
  }, [demoMode]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <nav className="home-nav">
          <div className="home-nav-logo">
            <div className="home-nav-blob-wrap">
              <BlobAvatar name="Collab" size={24} state="idle" color="#30d158" />
            </div>
            <span className="home-nav-wordmark">Collab</span>
          </div>
          <div className="home-nav-agents">
            {AGENT_PRESETS.map((p, i) => (
              <div key={p.name} className="home-nav-agent">
                <BlobAvatar name={p.name} size={20} state={blobStates[i]} color={p.color} />
              </div>
            ))}
          </div>
          <div className="home-nav-actions">
            {onSignOut ? (
              <button className="home-nav-btn" onClick={onSignOut}>Sign out</button>
            ) : (
              <button className="home-nav-cta" onClick={() => handleStarter(DEMO_STARTER)}>Try demo</button>
            )}
          </div>
        </nav>

        <header className="home-hero">
          <div className="home-hero-glow" />

          <h1 className="home-headline">
            <span className="home-headline-main">Every draft reviewed</span>
            <span className="home-headline-italic">by four experts.</span>
          </h1>
          <p className="home-subtitle">
            AI agents that read your docs and push back on what you missed.
          </p>

        </header>

        <section className="home-starters">
          <div className="home-starters-label">Start a session</div>
          <div className="home-starter-grid">
            {STARTERS.map((s, i) => (
              <button
                key={s.id}
                className="home-starter-card"
                onClick={() => handleStarter(s)}
                style={{ animationDelay: `${100 + i * 60}ms` }}
              >
                <div className="home-starter-strip">
                  {s.agents.map(a => (
                    <BlobAvatar key={a.name} name={a.name} size={20} state="idle" color={a.color} />
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
            <div className="home-recent-header">Recent</div>
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

        <footer className="home-footer">
          <div className="home-footer-left">
            <span className="home-footer-brand">Collab</span>
          </div>
          <div className="home-footer-right">
            <a href="/privacy" className="home-footer-link">Privacy</a>
            <a href="/terms" className="home-footer-link">Terms</a>
            <span className="home-footer-copy">Built by n3wth</span>
          </div>
        </footer>
      </div>
    </div>
  )
}
