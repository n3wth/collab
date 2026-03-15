import { useState, useEffect, useRef } from 'react'

type BlobState = 'idle' | 'thinking' | 'reading' | 'typing' | 'editing'

// Story arcs — each arc is a scripted conversation that plays over one choreography cycle.
// Lines are triggered in order as agents enter thinking/typing states.
// The choreography triggers them in this approximate order per cycle:
//   Aiden thinks → Aiden types → Nova thinks → Lex thinks → Mira types →
//   Nova types → Lex types → Mira thinks
// Each arc tells a coherent mini-story of a team reviewing a document.
const STORY_ARCS: { agent: string, line: string }[][] = [
  // Arc 1: API design review
  [
    { agent: 'Aiden', line: 'This endpoint needs pagination.' },
    { agent: 'Aiden', line: 'Adding cursor-based pagination...' },
    { agent: 'Nova', line: 'Will users understand cursors?' },
    { agent: 'Lex', line: 'Rate limits need documenting.' },
    { agent: 'Mira', line: 'Simplifying the query params...' },
    { agent: 'Nova', line: 'Default to 20 items per page.' },
    { agent: 'Lex', line: 'Added rate limit disclosure.' },
    { agent: 'Mira', line: 'What if we add a loading state?' },
  ],
  // Arc 2: Auth system discussion
  [
    { agent: 'Aiden', line: 'Token refresh is missing.' },
    { agent: 'Aiden', line: 'Adding refresh token flow...' },
    { agent: 'Nova', line: 'Users hate re-logging in.' },
    { agent: 'Lex', line: 'Tokens must expire in 24h.' },
    { agent: 'Mira', line: 'Session indicator in the nav...' },
    { agent: 'Nova', line: 'Silent refresh, no interruption.' },
    { agent: 'Lex', line: 'Need consent for persistent login.' },
    { agent: 'Mira', line: 'Toast on session extension?' },
  ],
  // Arc 3: Data pipeline spec
  [
    { agent: 'Aiden', line: 'No retry on failed ingestion.' },
    { agent: 'Aiden', line: 'Adding exponential backoff...' },
    { agent: 'Nova', line: 'How do users know it failed?' },
    { agent: 'Lex', line: 'Data retention is 90 days max.' },
    { agent: 'Mira', line: 'Error state needs a clear CTA...' },
    { agent: 'Nova', line: 'Email notification on failure.' },
    { agent: 'Lex', line: 'PII must be masked in logs.' },
    { agent: 'Mira', line: 'Progress bar for large imports?' },
  ],
  // Arc 4: Pricing page review
  [
    { agent: 'Aiden', line: 'Billing API needs idempotency.' },
    { agent: 'Aiden', line: 'Adding idempotency keys...' },
    { agent: 'Nova', line: 'Annual discount drives retention.' },
    { agent: 'Lex', line: 'Price change needs 30-day notice.' },
    { agent: 'Mira', line: 'Highlighting the popular plan...' },
    { agent: 'Nova', line: 'Free tier converts at 12%.' },
    { agent: 'Lex', line: 'Auto-renewal must be opt-in.' },
    { agent: 'Mira', line: 'Comparison table instead of cards?' },
  ],
]

interface Props {
  states: BlobState[]
  names: string[]
  colors: string[]
}

interface BubbleState {
  idx: number
  text: string
  id: number
  fading: boolean
}

export function HeroActivity({ states, names }: Props) {
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  const prevStates = useRef<BlobState[]>(['idle', 'idle', 'idle', 'idle'])
  const nextId = useRef(0)
  const showingUntil = useRef(0)
  const arcIdx = useRef(0)
  const lineIdx = useRef(0)

  useEffect(() => {
    const now = Date.now()

    // Find an agent that just transitioned to thinking or typing
    let triggered = -1
    for (let i = 0; i < states.length; i++) {
      const prev = prevStates.current[i]
      const curr = states[i]
      if (curr !== prev && (curr === 'thinking' || curr === 'typing')) {
        triggered = i
        break
      }
    }
    prevStates.current = [...states]

    if (triggered < 0) return
    if (now < showingUntil.current) return

    // Get the next line from the current story arc
    const arc = STORY_ARCS[arcIdx.current % STORY_ARCS.length]
    const line = arc[lineIdx.current % arc.length]

    // Find which blob index this agent maps to
    const agentIdx = names.indexOf(line.agent)
    if (agentIdx < 0) return

    const id = nextId.current++
    lineIdx.current++

    // Advance to next arc when we've exhausted this one
    if (lineIdx.current >= arc.length) {
      lineIdx.current = 0
      arcIdx.current++
    }

    const showTimer = window.setTimeout(() => {
      setBubble({ idx: agentIdx, text: line.line, id, fading: false })
      showingUntil.current = Date.now() + 2800
    }, 150)

    const fadeTimer = window.setTimeout(() => {
      setBubble(prev => prev?.id === id ? { ...prev, fading: true } : prev)
    }, 2300)

    const removeTimer = window.setTimeout(() => {
      setBubble(prev => prev?.id === id ? null : prev)
    }, 2700)

    return () => {
      clearTimeout(showTimer)
      clearTimeout(fadeTimer)
      clearTimeout(removeTimer)
    }
  }, [states, names])

  if (!bubble) return null

  return (
    <div
      key={bubble.id}
      className={`hero-bubble hero-bubble-${bubble.idx} ${bubble.fading ? 'hero-bubble-out' : ''}`}
    >
      {bubble.text}
    </div>
  )
}
