import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { AgentCursors } from './agent-cursor'
import { DocMinimap } from './doc-minimap'
import { createOrchestrator, type AgentConfig } from './orchestrator'
import { DEFAULT_PERSONAS } from './agent'
import { LoginPage } from './LoginPage'
import { LegalPage } from './LegalPage'
import { Sidebar } from './Sidebar'
import { TemplatePickerModal, type GoogleDocFile } from './TemplatePickerModal'
import { CommandPalette, type Command } from './CommandPalette'
import { AgentConfigurator } from './AgentConfigurator'
import { DOC_TEMPLATES } from './templates'
import { supabase } from './lib/supabase'
import { saveDocument, loadDocument, saveChatMessage, loadChatMessages, getSession, updateSessionTitle, listSessions, createSession, saveAgentPersonas, loadAgentPersonas } from './lib/session-store'
import { useAuth } from './lib/auth'
import type { Session } from './types'
import { BlobAvatar } from './blob-avatar'
import type { Editor } from '@tiptap/react'
import { ColorPanels } from '@paper-design/shaders-react'
import './App.css'

interface DocChange {
  type: 'insert' | 'replace' | 'delete'
  summary: string
  added?: string
  removed?: string
}

interface Message {
  id: string
  from: string
  text: string
  time: string
  showDocButton?: boolean
  reasoning?: string[]
  docChange?: DocChange
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



const AGENT_DESCRIPTIONS: Record<string, string> = {
  Aiden: 'Technical architecture and engineering. Writes specs, system design, and implementation details.',
  Nova: 'Product strategy and user research. Identifies gaps, frames adoption risks, and grounds ideas in user needs.',
  Lex: 'Legal and compliance review. Flags risks, regulatory concerns, and contractual implications.',
  Mira: 'Design and user experience. Advocates for users, evaluates usability, and proposes interface patterns.',
}

function AgentHoverCard({ name, agentState, agentConfig, onRemove }: { name: string, agentState: AgentState | null, agentConfig?: AgentConfig, onRemove?: () => void }) {
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

function ReasoningChain({ steps }: { steps: string[] }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`reasoning-chain ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded(!expanded)}>
      <div className="reasoning-header">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`reasoning-chevron ${expanded ? 'open' : ''}`}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="reasoning-label">{steps.length} {steps.length === 1 ? 'step' : 'steps'}</span>
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


const ChatMessage = memo(({ m, sameSender, agentState, userAvatarUrl }: {
  m: Message, sameSender: boolean, agentState?: AgentState | null, userAvatarUrl?: string
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
          ) : m.from === 'You' ? (
            userAvatarUrl ? (
              <img src={userAvatarUrl} alt="You" className="user-avatar" width={26} height={26} />
            ) : (
              <div className="user-avatar user-avatar-fallback" style={{ width: 26, height: 26 }} />
            )
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


const EMPTY_DOC = '<h1>Untitled</h1><p></p>'

function App() {
  const { user, loading: authLoading, signOut } = useAuth()
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const activeSessionRef = useRef<Session | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [chatWidth, setChatWidth] = useState(340)
  const [agentsPaused, setAgentsPaused] = useState(false)
  const agentsPausedRef = useRef(false)
  const resizingRef = useRef<'sidebar' | 'chat' | null>(null)
  const [activeAgents, setActiveAgents] = useState<AgentConfig[]>(DEFAULT_AGENT_CONFIGS)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle')
  const [showConfigurator, setShowConfigurator] = useState(false)
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({})
  const getAgentState = (name: string): AgentState => agentStates[name] || { status: 'idle', inDoc: false }
  const [messages, setMessages] = useState<Message[]>([])
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [input, setInput] = useState('')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [chatVisibleCount, setChatVisibleCount] = useState(50)
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
      DocMinimap.configure({
        agentColors: { Aiden: '#30d158', Nova: '#ff6961', Lex: '#64d2ff', Mira: '#ffd60a' },
      }),
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
        setSaveStatus('saving')
        const session = activeSessionRef.current
        if (session) {
          saveDocument(session.id, ed.getHTML())
            .then(() => { setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000) })
            .catch(err => console.error('[App] saveDocument error:', err))
          // Sync title from first H1
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const json = ed.getJSON() as any
          const h1 = json.content?.find((n: any) => n.type === 'heading' && n.attrs?.level === 1)
          const h1Text = h1?.content?.map((c: any) => c.text || '').join('') || ''
          if (h1Text && h1Text !== session.title) {
            setActiveSession(s => s ? { ...s, title: h1Text } : s)
            updateSessionTitle(session.id, h1Text).catch(err =>
              console.error('[App] updateSessionTitle error:', err)
            )
          }
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
          setTimeline(t => [...t, { id: uid(), color: agentCfg.color, tooltip: description }].slice(-50))
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
    if (!agentsPausedRef.current) {
      const orch = makeOrchestrator()
      orchestratorRef.current = orch
      return () => {
        if (orchestratorRef.current === orch) {
          orch.destroy()
          orchestratorRef.current = null
        }
      }
    }
  }, [makeOrchestrator])

  // URL routing: /s/{sessionId}
  const navigateToSession = useCallback((session: Session) => {
    history.pushState({ sessionId: session.id }, '', `/s/${session.id}`)
    window.scrollTo(0, 0)
  }, [])


  // Load session from URL on mount
  useEffect(() => {
    const match = window.location.pathname.match(/^\/s\/([a-f0-9-]+)$/)
    if (match) {
      const sessionId = match[1]
      getSession(sessionId).then(session => {
        if (session) {
          handleSessionSelect(session, [])
        }
      }).catch(() => {
        history.replaceState(null, '', '/')
      })
    }

    const onPopState = () => {
      window.scrollTo(0, 0)
      const m = window.location.pathname.match(/^\/s\/([a-f0-9-]+)$/)
      if (m) {
        getSession(m[1]).then(session => {
          if (session) handleSessionSelect(session, [])
        }).catch(() => {})
      } else {
        setActiveSession(null)
        activeSessionRef.current = null
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

    // Forward messages to orchestrator — agents respond in chat or doc
    orchestratorRef.current?.trigger('user-message', { instruction: text })
  }, [input])

  const sendSuggestion = useCallback((text: string) => {
    setMessages(m => [...m, { id: uid(), from: 'You', text, time: now() }])
    setInput('')
    const session = activeSessionRef.current
    if (session) {
      saveChatMessage(session.id, { sender: 'You', text }).catch(err =>
        console.error('[App] saveChatMessage error:', err)
      )
    }
    orchestratorRef.current?.trigger('user-message', { instruction: text })
  }, [])

  // Load sessions list for sidebar
  useEffect(() => {
    listSessions()
      .then(s => { setSessions(s); setSessionsLoaded(true) })
      .catch(() => setSessionsLoaded(true))
  }, [])

  const refreshSessions = useCallback(() => {
    listSessions().then(setSessions).catch(console.error)
  }, [])

  const handleSessionSelect = async (session: Session, agents: AgentConfig[]) => {
    // Reset all session-specific state
    setMessages([])
    setTimeline([])
    setAgentStates({})
    setSaveStatus('idle')
    lastProcessedMsg.current = 0

    setActiveSession(session)
    activeSessionRef.current = session
    // Update URL
    if (window.location.pathname !== `/s/${session.id}`) {
      navigateToSession(session)
    }
    // Apply starter agents if provided
    if (agents.length > 0) {
      setActiveAgents(agents)
    }

    // Load existing doc + messages + agent personas from Supabase
    const [savedDoc, savedMessages, savedPersonas] = await Promise.all([
      loadDocument(session.id).catch(() => null),
      loadChatMessages(session.id).catch(() => []),
      loadAgentPersonas(session.id).catch(() => []),
    ])

    // Restore agent personas if saved, otherwise use provided or current agents
    let currentAgents: AgentConfig[]
    if (savedPersonas.length > 0) {
      const restored = savedPersonas.map(p => ({
        name: p.name,
        persona: p.system_prompt,
        owner: p.owner,
        color: p.color,
      }))
      setActiveAgents(restored)
      currentAgents = restored
    } else {
      currentAgents = agents.length > 0 ? agents : activeAgents
      // Persist starter agents for new sessions
      if (agents.length > 0) {
        saveAgentPersonas(session.id, agentConfigsToPersonas(currentAgents))
          .catch(err => console.error('[App] saveAgentPersonas error:', err))
      }
    }

    if (savedDoc && editor) {
      editor.commands.setContent(savedDoc)
    } else {
      // New session — load template
      const template = DOC_TEMPLATES[session.template]
      if (template && editor) {
        editor.commands.setContent(template.content)
      } else if (editor) {
        editor.commands.setContent('<h1>Untitled</h1><p></p>')
      }
    }

    // Restore messages regardless of doc state
    if (savedMessages.length > 0) {
      const restored: Message[] = savedMessages.map(m => ({
        id: m.id, from: m.sender, text: m.text, time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), reasoning: m.reasoning || undefined,
      }))
      setMessages(restored)
      lastProcessedMsg.current = restored.length
    }
    lastDocSnapshot.current = editor?.getText() || ''

    // Reset doc scroll to top
    requestAnimationFrame(() => {
      const docBody = document.querySelector('.doc-body')
      if (docBody) docBody.scrollTop = 0
    })

    // Auto-open doc immediately
    setTimeout(() => {
      const newStates: Record<string, AgentState> = {}
      currentAgents.forEach(a => {
        newStates[a.name] = { status: 'reading', inDoc: true }
      })
      setAgentStates(prev => ({ ...prev, ...newStates }))
      orchestratorRef.current?.trigger('doc-opened')
    }, 300)
    refreshSessions()
  }

  const handleTemplatePick = async (starter: { title: string, template: import('./types').DocTemplate, agents: AgentConfig[] }) => {
    const session = await createSession(starter.title, starter.template)
    setShowTemplatePicker(false)
    handleSessionSelect(session, starter.agents)
  }

  const handleGoogleImport = async (file: GoogleDocFile) => {
    setShowTemplatePicker(false)
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const token = authSession?.provider_token
      if (!token) {
        alert('Google session expired. Please sign out and back in.')
        return
      }

      // Export Google Doc as HTML
      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/html`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!exportRes.ok) {
        console.error('[import] export failed:', exportRes.status)
        alert('Failed to export document from Google Drive')
        return
      }

      const rawHtml = await exportRes.text()
      // Extract body content, strip Google's style/span wrappers
      const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)
      let html = bodyMatch ? bodyMatch[1] : rawHtml
      html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      html = html.replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, '')
      html = html.replace(/\s+(class|style|id|data-[a-z-]+)="[^"]*"/gi, '')
      html = html.trim()

      // Create session and load the content
      const title = file.name.replace(/\.gdoc$|\.docx?$/i, '')
      const session = await createSession(title, 'blank')

      // Save the imported HTML immediately
      await saveDocument(session.id, html)

      // Load the session (will pick up the saved doc)
      handleSessionSelect(session, [])
    } catch (err) {
      console.error('[import] error:', err)
      alert('Import failed. Check console for details.')
    }
  }

  const handleSidebarSelect = (session: Session) => {
    handleSessionSelect(session, [])
  }

  // Cmd+N to create new doc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        setShowTemplatePicker(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  const params = new URLSearchParams(window.location.search)

  // Panel resize handlers
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      e.preventDefault()
      if (resizingRef.current === 'sidebar') {
        const w = e.clientX
        if (w < 120) {
          setSidebarCollapsed(true)
          setSidebarWidth(240)
          resizingRef.current = null
          document.body.style.cursor = ''
        } else {
          setSidebarWidth(Math.max(180, Math.min(400, w)))
        }
      } else if (resizingRef.current === 'chat') {
        const w = window.innerWidth - e.clientX
        setChatWidth(Math.max(260, Math.min(500, w)))
      }
    }
    const onMouseUp = () => {
      resizingRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const startResize = (panel: 'sidebar' | 'chat') => {
    resizingRef.current = panel
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // Sync page title with active session
  useEffect(() => {
    document.title = activeSession?.title
      ? `${activeSession.title} — Collab`
      : 'Collab'
  }, [activeSession?.title])

  const resetToHome = useCallback(() => {
    setActiveSession(null)
    activeSessionRef.current = null
    setAgentStates({})
    setMessages([])
    setTimeline([])
    setSaveStatus('idle')
    history.pushState(null, '', '/')
  }, [])

  // Legal pages — accessible without auth
  if (window.location.pathname === '/privacy') return <LegalPage page="privacy" />
  if (window.location.pathname === '/terms') return <LegalPage page="terms" />

  // Login page for unauthenticated users (non-localhost)
  // Show nothing while auth is loading to prevent flash
  if (!isLocalhost && authLoading) {
    return <div className="app-shell" style={{ background: 'var(--surface-0)' }} />
  }

  if (params.has('login') || (!isLocalhost && !user)) {
    return <LoginPage />
  }

  return (
    <div className={`app-shell ${activeSession ? 'app-shell-active' : ''}`}>
      <div className="app-layout">
      <div className="app-sidebar-column" style={{ width: sidebarCollapsed ? 0 : sidebarWidth, flexShrink: 0, overflow: 'hidden' }}>
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSession?.id ?? null}
          onSelect={handleSidebarSelect}
          onNewDoc={() => setShowTemplatePicker(true)}
          onDelete={(id) => { setSessions(s => s.filter(x => x.id !== id)); if (activeSession?.id === id) resetToHome() }}
          onRename={(id, title) => {
            updateSessionTitle(id, title).catch(console.error)
            setSessions(s => s.map(x => x.id === id ? { ...x, title } : x))
            if (activeSession?.id === id) setActiveSession(s => s ? { ...s, title } : s)
          }}
          onCollapse={() => setSidebarCollapsed(v => !v)}
          collapsed={sidebarCollapsed}
          user={user ?? null}
          onSignOut={isLocalhost ? undefined : signOut}
          onHome={resetToHome}
        />
      </div>
      {!sidebarCollapsed && activeSession && (
        <div className="resize-handle" onMouseDown={() => startResize('sidebar')} />
      )}
      <div className="app-main-column">
      {activeSession && <div className="app-header">
        <div className="header-editor-zone">
          {activeSession && (
            <>
              <span className="header-doc-title">{activeSession.title}</span>
              {saveStatus === 'saving' && <span className="header-save-status">Saving...</span>}
              {saveStatus === 'saved' && <span className="header-save-status saved">Saved</span>}
            </>
          )}
        </div>
        <div className="header-chat-zone" style={{ width: chatWidth + 4 }}>
          {activeSession && (
            <>
              <button
                className={`header-pause-btn ${agentsPaused ? 'paused' : ''}`}
                onClick={() => {
                  setAgentsPaused(v => {
                    const next = !v
                    agentsPausedRef.current = next
                    if (next) {
                      // Pause: destroy current orchestrator, clear states
                      orchestratorRef.current?.destroy()
                      orchestratorRef.current = null
                      setAgentStates({})
                    } else {
                      // Resume: create fresh orchestrator
                      const orch = makeOrchestrator()
                      orchestratorRef.current = orch
                      orch.trigger('doc-opened')
                    }
                    return next
                  })
                }}
                title={agentsPaused ? 'Resume agents' : 'Pause agents'}
              >
                {agentsPaused ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="6,4 20,12 6,20" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
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
                          setActiveAgents(prev => {
                            const updated = prev.filter((_, i) => i !== idx)
                            if (activeSessionRef.current) {
                              saveAgentPersonas(activeSessionRef.current.id, agentConfigsToPersonas(updated))
                                .catch(err => console.error('[App] saveAgentPersonas error:', err))
                            }
                            return updated
                          })
                        } : undefined}
                      />
                    </div>
                  )
                })}
                {activeAgents.length < 4 && (
                  <button
                    className="header-add-agent"
                    onClick={() => setShowConfigurator(v => !v)}
                    title="Add agent"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>}
      {showConfigurator && activeSession && (
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
              const updated = configs.map(c => ({
                name: c.name,
                persona: c.persona,
                owner: c.owner,
                color: c.color,
              }))
              setActiveAgents(updated)
              if (activeSessionRef.current) {
                saveAgentPersonas(activeSessionRef.current.id, agentConfigsToPersonas(updated))
                  .catch(err => console.error('[App] saveAgentPersonas error:', err))
              }
            }}
          />
        </div>
      )}
      <div className="app-body">
        {activeSession ? (
          <div className="workspace-area">
            <div className="workspace-content">
            {editor && (
              <div className="doc-panel">
                <div className="doc-toolbar">
                  <button
                    className={`doc-toolbar-btn ${editor.isActive('bold') ? 'active' : ''}`}
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    title="Bold (Ctrl+B)"
                  >
                    B
                  </button>
                  <button
                    className={`doc-toolbar-btn ${editor.isActive('italic') ? 'active' : ''}`}
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    title="Italic (Ctrl+I)"
                  >
                    <em>I</em>
                  </button>
                  <span className="doc-toolbar-sep" />
                  <button
                    className={`doc-toolbar-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
                    onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                    title="Heading 1"
                  >
                    H1
                  </button>
                  <button
                    className={`doc-toolbar-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
                    onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                    title="Heading 2"
                  >
                    H2
                  </button>
                  <span className="doc-toolbar-sep" />
                  <button
                    className={`doc-toolbar-btn ${editor.isActive('bulletList') ? 'active' : ''}`}
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    title="Bullet List"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
                  </button>
                  <button
                    className={`doc-toolbar-btn ${editor.isActive('orderedList') ? 'active' : ''}`}
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                    title="Ordered List"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" fontSize="8" fill="currentColor" stroke="none" fontFamily="sans-serif">1</text><text x="1" y="14" fontSize="8" fill="currentColor" stroke="none" fontFamily="sans-serif">2</text><text x="1" y="20" fontSize="8" fill="currentColor" stroke="none" fontFamily="sans-serif">3</text></svg>
                  </button>
                  <span className="doc-toolbar-spacer" />
                  <button
                    className="doc-toolbar-btn"
                    onClick={() => {
                      const text = editor.getText()
                      const h1 = text.split('\n')[0] || 'document'
                      const blob = new Blob([text], { type: 'text/markdown' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url; a.download = `${h1.slice(0, 40)}.md`; a.click()
                      URL.revokeObjectURL(url)
                    }}
                    title="Download as Markdown"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </button>
                  <button
                    className="doc-toolbar-btn"
                    onClick={async () => {
                      const token = (await supabase.auth.getSession()).data.session?.provider_token
                      if (!token) { alert('Sign in with Google to save to Drive'); return }
                      const html = editor.getHTML()
                      const title = activeSession?.title || 'Untitled'
                      const metadata = { name: `${title}.html`, mimeType: 'application/vnd.google-apps.document' }
                      const form = new FormData()
                      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
                      form.append('file', new Blob([html], { type: 'text/html' }))
                      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}` },
                        body: form,
                      })
                      if (res.ok) setSaveStatus('saved')
                      else console.error('Drive save failed:', res.status)
                    }}
                    title="Save to Google Drive"
                  >
                    <svg width="14" height="14" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-20.4 35.3c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 13.95z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-10.1-17.5c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 23.8h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>
                  </button>
                </div>
                <div className="doc-body">
                  <EditorContent editor={editor} />
                </div>
              </div>
            )}
            <div className="resize-handle" onMouseDown={() => startResize('chat')} />
            <div className="chat-panel chat-right" style={{ width: chatWidth, maxWidth: chatWidth, flexBasis: chatWidth }}>
              <div className="chat-messages">
                <div className="chat-messages-inner">
                {(() => {
                  const filtered = messages.filter(m => !m.text.startsWith('Couldn\'t find that text'))
                  const hiddenCount = Math.max(0, filtered.length - chatVisibleCount)
                  const visible = hiddenCount > 0 ? filtered.slice(-chatVisibleCount) : filtered
                  return (
                    <>
                      {hiddenCount > 0 && (
                        <button className="load-older-btn" onClick={() => setChatVisibleCount(c => c + 50)}>
                          Load {Math.min(50, hiddenCount)} older messages
                        </button>
                      )}
                      {visible.map((m, i, arr) => {
                        const prev = arr[i - 1]
                        const sameSender = prev && prev.from === m.from
                        return (
                          <ChatMessage key={m.id} m={m} sameSender={sameSender} agentState={activeAgents.some(a => a.name === m.from) ? getAgentState(m.from) : null} userAvatarUrl={user?.user_metadata?.avatar_url} />
                        )
                      })}
                    </>
                  )
                })()}
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
              {messages.length === 0 && (
                <div className="chat-suggestions">
                  {['Help me outline a product spec', 'Review my draft for clarity', 'What should this doc cover?', 'Brainstorm ideas for this topic'].map(text => (
                    <button key={text} className="chat-suggestion-chip" onClick={() => sendSuggestion(text)}>{text}</button>
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
                  placeholder={activeAgents.some(a => getAgentState(a.name).inDoc) ? 'Talk to the agents...' : 'Message the team...'}
                />
              </div>
            </div>
            </div>
            <Timeline entries={timeline} />
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-shader">
              <ColorPanels speed={0.5} scale={1.15} density={3} angle1={0} angle2={0} length={1.1} edges={false} blur={0} fadeIn={1} fadeOut={0.3} gradient={0} rotation={0} offsetX={0} offsetY={0} colors={['#FF9D00', '#FD4F30', '#809BFF', '#6D2EFF', '#333AFF', '#F15CFF', '#FFD557']} colorBack="#00000000" style={{ backgroundColor: '#000000', height: '100%', width: '100%' }} />
            </div>
            {sessionsLoaded && (
              <div className="empty-state-card">
                {sessions.length === 0 ? (
                  <>
                    <h2 className="empty-state-headline">Four experts are<br />waiting to review.</h2>
                    <p className="empty-state-desc">Create your first document. AI agents will read along, challenge assumptions, and fill gaps in real time.</p>
                  </>
                ) : (
                  <>
                    <h2 className="empty-state-headline">Pick up where<br />you left off.</h2>
                    <p className="empty-state-desc">Select a document from the sidebar or start something new.</p>
                  </>
                )}
                <button className="empty-state-cta" onClick={() => setShowTemplatePicker(true)}>
                  New document
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
      </div>
      {showTemplatePicker && (
        <TemplatePickerModal
          onSelect={handleTemplatePick}
          onImport={handleGoogleImport}
          onClose={() => setShowTemplatePicker(false)}
          importAvailable={!!user}
        />
      )}
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          commands={[
            { id: 'new-doc', label: 'New document', shortcut: '\u2318N', action: () => setShowTemplatePicker(true) },
            { id: 'toggle-sidebar', label: sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar', action: () => setSidebarCollapsed(v => !v) },
            ...(activeSession ? [
              { id: 'download-md', label: 'Download as Markdown', action: () => {
                const text = editorRef.current?.getText() || ''
                const title = activeSession.title || 'document'
                const blob = new Blob([text], { type: 'text/markdown' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a'); a.href = url; a.download = `${title.slice(0, 40)}.md`; a.click()
                URL.revokeObjectURL(url)
              }},
              { id: 'home', label: 'Go home', action: resetToHome },
            ] as Command[] : []),
            ...(!isLocalhost && user ? [{ id: 'signout', label: 'Sign out', action: signOut }] as Command[] : []),
          ]}
        />
      )}
    </div>
  )
}

export default App
