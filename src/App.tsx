import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { AgentCursors } from './agent-cursor'
import { createOrchestrator, type AgentConfig } from './orchestrator'
import { DEFAULT_PERSONAS } from './agent'
import { HomePage } from './HomePage'
import { SplashScreen } from './SplashScreen'
import { LoginPage } from './LoginPage'
import { AgentConfigurator } from './AgentConfigurator'
import { DOC_TEMPLATES } from './templates'
import { saveDocument, loadDocument, saveChatMessage, loadChatMessages } from './lib/session-store'
import { useAuth } from './lib/auth'
import type { Session } from './types'
import { BlobAvatar } from './blob-avatar'
import type { Editor } from '@tiptap/react'
import './App.css'

interface Message {
  id: string
  from: string
  text: string
  time: string
  showDocButton?: boolean
  reasoning?: string[]
}

interface AgentState {
  status: 'idle' | 'thinking' | 'typing' | 'reading' | 'editing'
  thought?: string
  inDoc: boolean
}

function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function uid() {
  return Math.random().toString(36).slice(2, 9)
}

const DEFAULT_AGENT_CONFIGS: AgentConfig[] = [
  { name: 'Aiden', persona: DEFAULT_PERSONAS.Aiden, owner: 'You', color: '#30d158' },
  { name: 'Nova', persona: DEFAULT_PERSONAS.Nova, owner: 'Sarah', color: '#ff6961' },
]

function ShapeAvatar({ name, size = 28, className = '' }: { name: string, size?: number, className?: string }) {
  const color = 'currentColor'
  const s = size

  const squarePoints = `${s * 0.18},${s * 0.18} ${s * 0.82},${s * 0.18} ${s * 0.82},${s * 0.82} ${s * 0.18},${s * 0.82}`
  const diamondPoints = `${s * 0.5},${s * 0.05} ${s * 0.95},${s * 0.5} ${s * 0.5},${s * 0.95} ${s * 0.05},${s * 0.5}`

  const points: Record<string, string> = {
    You: squarePoints,
    Sarah: diamondPoints,
  }

  const pts = points[name] || points.You

  return (
    <div className={`avatar-wrapper ${className}`} style={{ width: s, height: s }}>
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
        <polygon points={pts} fill={color} />
      </svg>
    </div>
  )
}


function AgentStatusBlob({ name, status, inDoc }: {
  name: string, status: AgentState['status'], inDoc: boolean
}) {
  if (!(inDoc && status !== 'idle')) return null
  return <BlobAvatar name={name} size={20} state={status} />
}

const AGENT_DESCRIPTIONS: Record<string, string> = {
  Aiden: 'Technical architecture and engineering. Writes specs, system design, and implementation details.',
  Nova: 'Product strategy and user research. Identifies gaps, frames adoption risks, and grounds ideas in user needs.',
  Lex: 'Legal and compliance review. Flags risks, regulatory concerns, and contractual implications.',
  Mira: 'Design and user experience. Advocates for users, evaluates usability, and proposes interface patterns.',
}

function AgentHoverCard({ name, agentState, agentConfig }: { name: string, agentState: AgentState | null, agentConfig?: AgentConfig }) {
  const desc = AGENT_DESCRIPTIONS[name] || agentConfig?.persona?.split('.')[0]?.replace(/^You are \w+, /, '') || 'AI agent'
  const owner = agentConfig?.owner || 'You'
  const tools = ['read', 'insert', 'replace', 'chat', 'search']

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
      <div className="agent-hover-card-section">
        <div className="agent-hover-card-section-label">Tools</div>
        <div className="agent-hover-card-tools">
          {tools.map(t => <span key={t} className="agent-tool-tag">{t}</span>)}
        </div>
      </div>
      <div className="agent-hover-card-section">
        <div className="agent-hover-card-section-label">Owner</div>
        <div className="agent-hover-card-owner">{owner}</div>
      </div>
      <div className="agent-hover-card-divider" />
      <div className="agent-hover-card-status">
        <span className={`agent-hover-card-dot ${agentState?.status !== 'idle' ? 'active' : ''}`} />
        {agentState?.status === 'idle' ? 'Idle' : agentState?.thought || agentState?.status}
        {agentState?.inDoc && <span className="agent-hover-card-location">In document</span>}
      </div>
    </div>
  )
}

function ReasoningChain({ steps }: { steps: string[] }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`reasoning-chain ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded(!expanded)}>
      <div className="reasoning-header">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`reasoning-chevron ${expanded ? 'open' : ''}`}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="reasoning-label">{steps.length} steps</span>
      </div>
      {expanded && (
        <div className="reasoning-steps">
          {steps.map((step, i) => (
            <div key={i} className="reasoning-step">
              <span className="reasoning-step-num">{i + 1}</span>
              <span className="reasoning-step-text">{step}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


const FormatMentions = memo(({ text, names }: { text: string, names?: string[] }) => {
  const allNames = names && names.length > 0 ? [...names, 'Sarah'] : ['Aiden', 'Nova', 'Lex', 'Mira', 'Sarah']
  const pattern = new RegExp(`(@?(?:${allNames.join('|')}))(?=\\s|$|[.,!?;:])`, 'gi')
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, i) => {
        const bare = part.replace(/^@/, '')
        const normalized = bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase()
        pattern.lastIndex = 0
        if (pattern.test(part)) {
          pattern.lastIndex = 0
          return (
            <span key={i} className="mention-tag">
              @{normalized}
            </span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
})


const ChatMessage = memo(({ m, sameSender, docOpen, onOpenDoc, agentState }: {
  m: Message, sameSender: boolean, docOpen: boolean, onOpenDoc: () => void, agentState?: AgentState | null
}) => {
  const isAgent = m.from !== 'You' && m.from !== 'Sarah' && m.from !== 'System'
  const displayText = m.text.replace('[from doc] ', '')
  return (
    <div className={`msg ${isAgent ? 'msg-agent' : 'msg-human'} ${sameSender ? 'msg-consecutive' : ''}`} data-agent={isAgent ? m.from.toLowerCase() : undefined}>
      {!sameSender && (
        <div className={`msg-avatar ${isAgent ? 'msg-avatar-agent' : ''}`}>
          {isAgent ? (
            <>
              <BlobAvatar name={m.from} size={26} />
              <AgentHoverCard name={m.from} agentState={agentState ?? null} />
            </>
          ) : (
            <ShapeAvatar name={m.from} size={26} />
          )}
        </div>
      )}
      <div className={`msg-body ${sameSender ? 'msg-body-consecutive' : ''}`}>
        {!sameSender && (
          <div className="msg-header">
            <span className="msg-name">{m.from}</span>
            <span className="msg-time">{m.time}</span>
          </div>
        )}
        {isAgent && m.reasoning && m.reasoning.length > 0 && (
          <ReasoningChain steps={m.reasoning} />
        )}
        <div className="msg-text">
          <FormatMentions text={displayText} />
        </div>
        {m.showDocButton && !docOpen && (
          <button className="doc-prompt" onClick={onOpenDoc}>Open doc</button>
        )}
      </div>
    </div>
  )
})

interface TimelineEntry {
  id: string
  color: string
  tooltip: string
}

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const [hoveredTip, setHoveredTip] = useState<{ text: string, x: number, y: number } | null>(null)
  if (entries.length === 0) return null
  return (
    <div className="timeline">
      {entries.slice(-20).map(e => (
        <div
          key={e.id}
          className="timeline-dot"
          style={{ background: e.color }}
          onMouseEnter={(ev) => {
            const rect = ev.currentTarget.getBoundingClientRect()
            const x = Math.max(140, Math.min(window.innerWidth - 140, rect.left + rect.width / 2))
            setHoveredTip({ text: e.tooltip, x, y: rect.top })
          }}
          onMouseLeave={() => setHoveredTip(null)}
        />
      ))}
      {hoveredTip && (
        <div className="timeline-tooltip" style={{ left: hoveredTip.x, top: hoveredTip.y }}>
          {hoveredTip.text}
        </div>
      )}
    </div>
  )
}

function AgentActivityBar({ agents, getAgentState }: { agents: AgentConfig[], getAgentState: (name: string) => AgentState }) {
  const hasActivity = agents.some(a => getAgentState(a.name).status !== 'idle')
  if (!hasActivity) return null
  return (
    <div className="agent-activity-bar">
      {agents.map(a => {
        const state = getAgentState(a.name)
        const isActive = state.status !== 'idle'
        return (
          <div
            key={a.name}
            className={`agent-activity-segment ${isActive ? `active-${state.status}` : ''}`}
            style={{ background: isActive ? a.color : 'transparent' }}
          />
        )
      })}
    </div>
  )
}

const EMPTY_DOC = '<h1>Untitled</h1><p></p>'

function App() {
  const { user, loading: authLoading, signOut } = useAuth()
  const [showSplash, setShowSplash] = useState(true)
  const [demoMode, setDemoMode] = useState(false)
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const activeSessionRef = useRef<Session | null>(null)
  const [docOpen, setDocOpen] = useState(false)
  const [activeAgents, setActiveAgents] = useState<AgentConfig[]>(DEFAULT_AGENT_CONFIGS)
  const [showConfigurator, setShowConfigurator] = useState(false)
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({})
  const getAgentState = (name: string): AgentState => agentStates[name] || { status: 'idle', inDoc: false }
  const [messages, setMessages] = useState<Message[]>([])
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [input, setInput] = useState('')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const MENTION_NAMES = [...activeAgents.map(a => a.name), 'Sarah']
  const chatEndRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)
  const orchestratorRef = useRef<ReturnType<typeof createOrchestrator> | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const docSaveTimer = useRef<number | null>(null)
  const docEditTimer = useRef<number | null>(null)
  const lastDocSnapshot = useRef('')
  messagesRef.current = messages

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing...' }),
      AgentCursors,
    ],
    content: EMPTY_DOC,
    editorProps: {
      attributes: {
        class: 'doc-editor',
      },
    },
    onUpdate: ({ editor: ed }) => {
      // Debounced save to Supabase
      if (docSaveTimer.current) clearTimeout(docSaveTimer.current)
      docSaveTimer.current = window.setTimeout(() => {
        const session = activeSessionRef.current
        if (session) {
          saveDocument(session.id, ed.getHTML()).catch(err =>
            console.error('[App] saveDocument error:', err)
          )
        }
      }, 2000)
      // Detect user typing in doc
      if (docEditTimer.current) clearTimeout(docEditTimer.current)
      docEditTimer.current = window.setTimeout(() => {
        const currentText = ed.getText()
        const prev = lastDocSnapshot.current
        if (!prev) { lastDocSnapshot.current = currentText; return }
        let i = 0
        while (i < prev.length && i < currentText.length && prev[i] === currentText[i]) i++
        const added = currentText.slice(i, currentText.length - (prev.length - i))
        lastDocSnapshot.current = currentText
        if (added.trim().length > 15 && orchestratorRef.current) {
          orchestratorRef.current.trigger('user-message', {
            instruction: `The user just typed this in the document: "${added.trim().slice(0, 200)}". React to it — if it's an instruction, follow it. If it's content, build on it.`,
          })
        }
      }, 3000)
    },
  })
  editorRef.current = editor

  useEffect(() => {
    if (editor) lastDocSnapshot.current = editor.getText()
  }, [editor])

  useEffect(() => {
    return () => {
      if (docSaveTimer.current) clearTimeout(docSaveTimer.current)
      if (docEditTimer.current) clearTimeout(docEditTimer.current)
    }
  }, [])

  const pendingReasoning = useRef<Record<string, string[]>>({})

  const makeOrchestrator = useCallback(() => {
    return createOrchestrator({
      getEditor: () => editorRef.current,
      getDocText: () => editorRef.current?.getText() || '',
      getMessages: () => messagesRef.current.slice(-10).map(m => ({ from: m.from, text: m.text })),
      agents: activeAgents,
      onAgentState: (agent, status, thought) => {
        setAgentStates(prev => ({
          ...prev,
          [agent]: { ...prev[agent] || { status: 'idle', inDoc: false }, status, thought },
        }))
      },
      onAgentReasoning: (agent, reasoning) => {
        pendingReasoning.current[agent] = reasoning
      },
      onDocAction: (agent, description) => {
        const agentCfg = activeAgents.find(a => a.name === agent)
        if (agentCfg) {
          setTimeline(t => [...t, { id: uid(), color: agentCfg.color, tooltip: description }])
        }
      },
      onChatMessage: (from, text) => {
        const reasoning = pendingReasoning.current[from]
        if (reasoning) delete pendingReasoning.current[from]
        setMessages(m => {
          const last = m[m.length - 1]
          if (last && last.from === from && last.text === text) return m
          return [...m, { id: uid(), from, text, time: now(), reasoning }]
        })
        // Persist to Supabase
        const session = activeSessionRef.current
        if (session) {
          saveChatMessage(session.id, { sender: from, text, reasoning }).catch(err =>
            console.error('[App] saveChatMessage error:', err)
          )
        }
      },
      onError: (_agent, error, failures) => {
        if (failures >= 3) {
          setMessages(m => [...m, {
            id: uid(),
            from: 'System',
            text: `Agent paused after ${failures} failures: ${error.message}`,
            time: now(),
          }])
        }
      },
    })
  }, [])

  useEffect(() => {
    const orch = makeOrchestrator()
    orchestratorRef.current = orch
    return () => {
      orch.destroy()
      orchestratorRef.current = null
    }
  }, [makeOrchestrator])

  const lastProcessedMsg = useRef(0)
  useEffect(() => {
    const newMsgs = messages.slice(lastProcessedMsg.current)
    lastProcessedMsg.current = messages.length
    for (const m of newMsgs) {
      orchestratorRef.current?.onMessage(m.from, m.text)
    }
  }, [messages])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const openDocWithAgents = useCallback(() => {
    setDocOpen(true)
    const newStates: Record<string, AgentState> = {}
    activeAgents.forEach((a, i) => {
      newStates[a.name] = { status: 'reading', inDoc: true, thought: i === 0 ? 'Opening the document...' : 'Joining...' }
    })
    setAgentStates(prev => ({ ...prev, ...newStates }))
    if (activeAgents.length > 0) {
      setMessages(m => [...m,
        { id: uid(), from: activeAgents[0].name, text: 'Opening the doc now. Let me review and contribute.', time: now() },
      ])
    }
    if (activeAgents.length > 1) {
      setTimeout(() => {
        setMessages(m => [...m,
          { id: uid(), from: activeAgents[1].name, text: 'I\'m in. Let me take a look too.', time: now() },
        ])
      }, 1200)
    }
    orchestratorRef.current?.trigger('doc-opened')
  }, [activeAgents])

  const sendMessage = useCallback(() => {
    if (!input.trim()) return
    const text = input.trim()
    setMessages(m => [...m, { id: uid(), from: 'You', text, time: now() }])
    setInput('')
    // Persist user message
    const session = activeSessionRef.current
    if (session) {
      saveChatMessage(session.id, { sender: 'You', text }).catch(err =>
        console.error('[App] saveChatMessage error:', err)
      )
    }

    const lower = text.toLowerCase()

    if (lower.includes('doc') && (lower.includes('go') || lower.includes('work') || lower.includes('start') || lower.includes('open'))) {
      setTimeout(() => openDocWithAgents(), 800)
      return
    }

    if (lower.includes('come back') || lower.includes('stop') || lower.includes('close')) {
      setTimeout(() => {
        orchestratorRef.current?.destroy()
        const idleStates: Record<string, AgentState> = {}
        activeAgents.forEach(a => { idleStates[a.name] = { status: 'idle', inDoc: false } })
        setAgentStates(idleStates)
        setDocOpen(false)
        orchestratorRef.current = makeOrchestrator()
        const backMsgs = activeAgents.slice(0, 2).map(a => ({
          id: uid(), from: a.name, text: 'Back from the doc.', time: now(),
        }))
        setMessages(m => [...m, ...backMsgs])
      }, 800)
      return
    }

    // Always forward messages to orchestrator — agents respond in chat or doc
    orchestratorRef.current?.trigger('user-message', { instruction: text })
  }, [input, activeAgents, openDocWithAgents, makeOrchestrator])

  const resetSession = useCallback(() => {
    orchestratorRef.current?.destroy()
    setDocOpen(false)
    const idleStates: Record<string, AgentState> = {}
    activeAgents.forEach(a => { idleStates[a.name] = { status: 'idle', inDoc: false } })
    setAgentStates(idleStates)
    const template = activeSession ? DOC_TEMPLATES[activeSession.template] : null
    editor?.commands.setContent(template?.content || EMPTY_DOC)
    lastDocSnapshot.current = editor?.getText() || ''
    setMessages([])
    lastProcessedMsg.current = 0
    orchestratorRef.current = makeOrchestrator()
  }, [editor, makeOrchestrator, activeSession])

  const handleSessionSelect = async (session: Session, agents: AgentConfig[]) => {
    setActiveSession(session)
    activeSessionRef.current = session
    // Apply starter agents if provided
    if (agents.length > 0) {
      setActiveAgents(agents)
    }
    const currentAgents = agents.length > 0 ? agents : activeAgents

    // Load existing doc + messages from Supabase
    const [savedDoc, savedMessages] = await Promise.all([
      loadDocument(session.id).catch(() => null),
      loadChatMessages(session.id).catch(() => []),
    ])

    if (savedDoc && editor) {
      // Resume existing session
      editor.commands.setContent(savedDoc)
      const restored: Message[] = savedMessages.map(m => ({
        id: m.id, from: m.sender, text: m.text, time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), reasoning: m.reasoning || undefined,
      }))
      setMessages(restored)
      lastProcessedMsg.current = restored.length
    } else {
      // New session — load template
      const template = DOC_TEMPLATES[session.template]
      if (template && editor) {
        editor.commands.setContent(template.content)
      }
      // Set initial messages with agent introductions
      const agentNames = currentAgents.map(a => a.name)
      const introMessages: Message[] = [
        { id: uid(), from: agentNames[0] || 'Aiden', text: `Ready to help with this ${template?.label || 'document'}. Open the doc and I'll start reviewing, or just chat here.`, time: now(), showDocButton: true },
      ]
      if (agentNames.length > 1) {
        introMessages.push({ id: uid(), from: agentNames[1] || 'Nova', text: 'Same here. Let me know what you need.', time: now() })
      }
      setMessages(introMessages)
      lastProcessedMsg.current = introMessages.length
    }
    lastDocSnapshot.current = editor?.getText() || ''
  }

  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

  if (showSplash) {
    return <SplashScreen
      onDismiss={() => setShowSplash(false)}
      onDemo={() => {
        setShowSplash(false)
        setDemoMode(true)
      }}
    />
  }

  if (!isLocalhost && authLoading) {
    return null
  }

  if (!isLocalhost && !user) {
    return <LoginPage />
  }

  if (!activeSession) {
    return <HomePage onSelect={handleSessionSelect} onSignOut={isLocalhost ? undefined : signOut} demoMode={demoMode} onDemoConsumed={() => setDemoMode(false)} />
  }

  return (
    <div className="shell">
      <div className="main-area">
        <div className="main-header">
          <button className="back-btn" onClick={() => { setActiveSession(null); activeSessionRef.current = null; setDocOpen(false) }} aria-label="Back to home">&lsaquo; Back</button>
          <span className="chat-header-title">{activeSession.title}</span>
          <div className="header-participants">
            {activeAgents.map(agent => {
              const agentState = getAgentState(agent.name)
              return (
                <div key={agent.name} className="header-avatar-wrap">
                  <BlobAvatar name={agent.name} size={24} state={agentState.status} />
                  <AgentHoverCard name={agent.name} agentState={agentState} agentConfig={agent} />
                </div>
              )
            })}
          </div>
          <div className="header-buttons">
            <button className="reset-btn" onClick={() => setShowConfigurator(!showConfigurator)}>
              {showConfigurator ? 'Close' : 'Agents'}
            </button>
            <button className="reset-btn" onClick={resetSession}>Reset</button>
            <button
              className={`doc-toggle-btn ${docOpen ? 'active' : ''}`}
              onClick={() => {
                if (docOpen) {
                  orchestratorRef.current?.destroy()
                  setDocOpen(false)
                  const idleStates: Record<string, AgentState> = {}
                  activeAgents.forEach(a => { idleStates[a.name] = { status: 'idle', inDoc: false } })
                  setAgentStates(idleStates)
                  orchestratorRef.current = makeOrchestrator()
                } else {
                  openDocWithAgents()
                }
              }}
            >
              Doc
            </button>
          </div>
        </div>
        {showConfigurator && (
          <div className="configurator-panel">
            <AgentConfigurator
              agents={activeAgents.map(a => ({
                name: a.name,
                description: a.persona.split('.')[0].replace(/^You are \w+, /, ''),
                persona: a.persona,
                owner: a.owner,
                color: a.color,
              }))}
              onChange={(configs) => {
                setActiveAgents(configs.map(c => ({
                  name: c.name,
                  persona: c.persona,
                  owner: c.owner,
                  color: c.color,
                })))
              }}
            />
          </div>
        )}
        <AgentActivityBar agents={activeAgents} getAgentState={getAgentState} />
        <div className="main-content">
        <div className={`chat-panel ${docOpen ? 'chat-side' : 'chat-full'}`}>
          <div className="chat-messages">
            <div className="chat-messages-inner">
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const sameSender = prev && prev.from === m.from
              return (
                <ChatMessage key={m.id} m={m} sameSender={sameSender} docOpen={docOpen} onOpenDoc={openDocWithAgents} agentState={activeAgents.some(a => a.name === m.from) ? getAgentState(m.from) : null} />
              )
            })}
            {activeAgents.map(agent => {
              const state = getAgentState(agent.name)
              return (state.status === 'thinking' || state.status === 'typing') && !state.inDoc ? (
                <div key={agent.name} className="msg">
                  <div className="msg-avatar">
                    <BlobAvatar name={agent.name} size={26} state={state.status} />
                  </div>
                  <div className="msg-body">
                    <div className="msg-header">
                      <span className="msg-name">{agent.name}</span>
                    </div>
                    <div className="msg-thinking">
                      <span className="thinking-text">{state.thought || 'Thinking...'}</span>
                    </div>
                  </div>
                </div>
              ) : null
            })}
            <div ref={chatEndRef} />
            </div>
          </div>
          {docOpen && (
            <div className="agent-status-bar">
              {activeAgents.map(agent => (
                <AgentStatusBlob key={agent.name} name={agent.name} status={getAgentState(agent.name).status} inDoc={getAgentState(agent.name).inDoc} />
              ))}
            </div>
          )}
          <div className="chat-input">
            {mentionQuery !== null && (() => {
              const filtered = MENTION_NAMES.filter(n => n.toLowerCase().startsWith(mentionQuery.toLowerCase()))
              if (filtered.length === 0) return null
              const safeIndex = Math.min(mentionIndex, filtered.length - 1)
              return (
                <div className="mention-dropdown">
                  {filtered.map((n, i) => (
                    <div
                      key={n}
                      className={`mention-option ${i === safeIndex ? 'mention-option-active' : ''}`}
                      onMouseDown={e => {
                        e.preventDefault()
                        const atIdx = input.lastIndexOf('@')
                        setInput(input.slice(0, atIdx) + '@' + n + ' ')
                        setMentionQuery(null)
                      }}
                    >
                      <BlobAvatar name={n} size={16} />
                      <span>{n}</span>
                    </div>
                  ))}
                </div>
              )
            })()}
            <input
              value={input}
              onChange={e => {
                const val = e.target.value
                setInput(val)
                const atIdx = val.lastIndexOf('@')
                if (atIdx !== -1 && (atIdx === 0 || val[atIdx - 1] === ' ')) {
                  const query = val.slice(atIdx + 1)
                  if (!query.includes(' ')) {
                    setMentionQuery(query)
                    setMentionIndex(0)
                    return
                  }
                }
                setMentionQuery(null)
              }}
              onKeyDown={e => {
                if (mentionQuery !== null) {
                  const filtered = MENTION_NAMES.filter(n => n.toLowerCase().startsWith(mentionQuery.toLowerCase()))
                  if (e.key === 'Tab' || (e.key === 'Enter' && filtered.length > 0)) {
                    e.preventDefault()
                    const safeIndex = Math.min(mentionIndex, filtered.length - 1)
                    const pick = filtered[safeIndex] ?? filtered[0]
                    if (pick) {
                      const atIdx = input.lastIndexOf('@')
                      setInput(input.slice(0, atIdx) + '@' + pick + ' ')
                      setMentionQuery(null)
                    }
                    return
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setMentionIndex(i => Math.min(i + 1, filtered.length - 1))
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setMentionIndex(i => Math.max(i - 1, 0))
                    return
                  }
                  if (e.key === 'Escape') {
                    setMentionQuery(null)
                    return
                  }
                }
                if (e.key === 'Enter') sendMessage()
              }}
              placeholder={activeAgents.some(a => getAgentState(a.name).inDoc) ? 'Talk to the agents...' : 'Message the group...'}
            />
          </div>
        </div>

        {docOpen && (
          <div className="doc-panel">
            <div className="doc-body">
              <EditorContent editor={editor} />
            </div>
          </div>
        )}
        </div>
        {docOpen && <Timeline entries={timeline} />}
      </div>
    </div>
  )
}

export default App
