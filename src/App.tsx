import { useState, useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { AgentCursors } from './agent-cursor'
import { createOrchestrator } from './orchestrator'
import type { Editor } from '@tiptap/react'
import './App.css'

interface Message {
  id: string
  from: string
  text: string
  time: string
  showDocButton?: boolean
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

const AGENTS: Record<string, { color: string, bgColor: string }> = {
  Aiden: { color: '#5f6368', bgColor: '#f1f3f5' },
  Nova: { color: '#5f6368', bgColor: '#f1f3f5' },
}

// AI agents mirror their human's shape but as an outline
const HUMAN_FOR_AGENT: Record<string, string> = {
  Aiden: 'You',
  Nova: 'Sarah',
}

function ShapeAvatar({ name, size = 28, className = '', thinking = false }: { name: string, size?: number, className?: string, thinking?: boolean }) {
  const color = '#1a1a1a'
  const s = size
  const strokeW = s * 0.09
  const isAgent = name in HUMAN_FOR_AGENT
  const shapeName = HUMAN_FOR_AGENT[name] || name

  const squarePoints = `${s * 0.18},${s * 0.18} ${s * 0.82},${s * 0.18} ${s * 0.82},${s * 0.82} ${s * 0.18},${s * 0.82}`
  const diamondPoints = `${s * 0.5},${s * 0.05} ${s * 0.95},${s * 0.5} ${s * 0.5},${s * 0.95} ${s * 0.05},${s * 0.5}`

  const points: Record<string, string> = {
    You: squarePoints,
    Sarah: diamondPoints,
  }

  const pts = points[shapeName] || points.You
  const pad = s * 0.1
  const outerSquarePoints = `${s * 0.18 - pad},${s * 0.18 - pad} ${s * 0.82 + pad},${s * 0.18 - pad} ${s * 0.82 + pad},${s * 0.82 + pad} ${s * 0.18 - pad},${s * 0.82 + pad}`
  const outerDiamondPoints = `${s * 0.5},${s * 0.05 - pad} ${s * 0.95 + pad},${s * 0.5} ${s * 0.5},${s * 0.95 + pad} ${s * 0.05 - pad},${s * 0.5}`
  const outerPts: Record<string, string> = { You: outerSquarePoints, Sarah: outerDiamondPoints }
  const oPts = outerPts[shapeName] || outerPts.You
  const outerSize = s + pad * 2

  return (
    <div className={`avatar-wrapper ${className}`} style={{ width: s, height: s }}>
      {thinking && (
        <svg className="thinking-border" width={outerSize} height={outerSize} viewBox={`${-pad} ${-pad} ${outerSize} ${outerSize}`} style={{ position: 'absolute', top: -pad, left: -pad }}>
          <polygon points={oPts} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray={`${s * 0.15} ${s * 0.1}`} className="thinking-border-path" />
        </svg>
      )}
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
        {isAgent ? (
          <polygon points={pts} fill="none" stroke={color} strokeWidth={strokeW} />
        ) : (
          <polygon points={pts} fill={color} />
        )}
      </svg>
    </div>
  )
}



function AgentStatusChip({ name, color, status, inDoc }: {
  name: string, color: string, status: AgentState['status'], inDoc: boolean
}) {
  const isVisible = inDoc && status !== 'idle'
  if (!isVisible) return null

  const label = status === 'reading' ? 'reading' : status === 'thinking' ? 'thinking' : 'writing'
  const statusClass = status === 'reading' ? 'status-chip-reading' : status === 'thinking' ? 'status-chip-thinking' : 'status-chip-writing'

  return (
    <div className={`status-chip ${statusClass}`} style={{ borderColor: color + '40', background: color + '06' }}>
      <div className="status-chip-avatar-wrap">
        <ShapeAvatar name={name} size={18} />
        <span className="status-chip-ring" style={{ borderColor: color }} />
      </div>
      <span className="status-chip-label status-chip-label-active" style={{ color }}>
        {label}
      </span>
    </div>
  )
}

const ALL_NAMES = [...Object.keys(AGENTS), 'Sarah']
const mentionRegex = new RegExp(`(@?(?:${ALL_NAMES.join('|')}))(?=\\s|$|[.,!?;:])`, 'gi')

function FormatMentions({ text }: { text: string }) {
  const parts = text.split(mentionRegex)
  return (
    <>
      {parts.map((part, i) => {
        const bare = part.replace(/^@/, '')
        const normalized = bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase()
        const agent = AGENTS[normalized]
        if (mentionRegex.test(part)) {
          mentionRegex.lastIndex = 0
          return (
            <span key={i} className="mention-tag" style={agent ? { color: agent.color, background: agent.bgColor } : undefined}>
              @{normalized}
            </span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}


const STORAGE_KEYS = { doc: 'collab-doc-content', chat: 'collab-chat-messages' }

function loadSavedDoc(): string | null {
  try { return localStorage.getItem(STORAGE_KEYS.doc) } catch { return null }
}

function loadSavedMessages(): Message[] | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.chat)
    if (!saved) return null
    return JSON.parse(saved) as Message[]
  } catch { return null }
}

const INITIAL_DOC = `<h1>Collab v2 — Product Brief</h1>
<h2>Problem</h2>
<p>Knowledge workers spend 60% of their day context-switching between tools. Documents live in one place, conversations in another, and decisions fall through the cracks. When you need to act on something discussed in chat, you copy-paste into a doc. When a doc needs input, you ping someone in Slack. The information graph is fragmented.</p>
<h2>Insight</h2>
<p>The unit of collaboration isn't a document or a message — it's a decision. Every artifact is just a waypoint toward alignment. If agents can maintain continuity across these waypoints, they collapse the distance between thinking and doing.</p>
<h2>Proposed Solution</h2>
<p>A workspace where AI agents are first-class participants. Each person brings their own agent with persistent context. Agents join conversations, edit documents, and coordinate work — visible to everyone in real time. The agent doesn't replace the human; it extends their reach.</p>
<h2>Architecture</h2>
<ul>
<li>CRDT-based document sync with agent cursor presence</li>
<li>Per-agent context window with cross-session memory</li>
<li>Turn-based coordination protocol to prevent edit conflicts</li>
<li>Streaming action model: read → think → write, with each step visible</li>
</ul>
<h2>Success Criteria</h2>
<ul>
<li>Time from discussion to documented decision: &lt;5 minutes</li>
<li>Zero copy-paste between chat and docs</li>
<li>Agent actions are auditable and reversible</li>
<li>Users trust the agent enough to let it draft without supervision</li>
</ul>
<h2>Open Questions</h2>
<ul>
<li>How does the agent signal uncertainty vs confidence?</li>
<li>What's the right level of autonomy for v1?</li>
<li>How do we handle conflicting instructions from multiple users?</li>
</ul>`

function App() {
  const [docOpen, setDocOpen] = useState(false)
  const [aiden, setAiden] = useState<AgentState>({ status: 'idle', inDoc: false })
  const [nova, setNova] = useState<AgentState>({ status: 'idle', inDoc: false })
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = loadSavedMessages()
    if (saved && saved.length > 0) return saved
    return [
      { id: uid(), from: 'You', text: 'the v2 brief needs to be ready for the board review Friday. can you two get in there and tighten it up?', time: '2:41 PM' },
      { id: uid(), from: 'Sarah', text: 'yeah the architecture section is still too vague and we need real success metrics, not aspirational ones', time: '2:41 PM' },
      { id: uid(), from: 'Aiden', text: 'I\'ll take architecture and the technical open questions. The sync protocol needs specifics — I\'ll spec out the CRDT approach and agent coordination model.', time: '2:42 PM', showDocButton: true },
      { id: uid(), from: 'Nova', text: 'I\'ll sharpen the problem statement and success criteria. Sarah\'s right — "users trust the agent" isn\'t measurable. I\'ll define concrete thresholds.', time: '2:42 PM' },
    ]
  })
  const [input, setInput] = useState('')
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
    content: loadSavedDoc() || INITIAL_DOC,
    editorProps: {
      attributes: {
        class: 'doc-editor',
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (docSaveTimer.current) clearTimeout(docSaveTimer.current)
      docSaveTimer.current = window.setTimeout(() => {
        try { localStorage.setItem(STORAGE_KEYS.doc, ed.getHTML()) } catch { /* full */ }
      }, 2000)
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
    try { localStorage.setItem(STORAGE_KEYS.chat, JSON.stringify(messages)) } catch { /* full */ }
  }, [messages])

  useEffect(() => {
    return () => {
      if (docSaveTimer.current) clearTimeout(docSaveTimer.current)
      if (docEditTimer.current) clearTimeout(docEditTimer.current)
    }
  }, [])

  const makeOrchestrator = useCallback(() => {
    return createOrchestrator({
      getEditor: () => editorRef.current,
      getDocText: () => editorRef.current?.getText() || '',
      getMessages: () => messagesRef.current.slice(-10).map(m => ({ from: m.from, text: m.text })),
      onAgentState: (agent, status, thought) => {
        const setter = agent === 'Aiden' ? setAiden : setNova
        setter(a => ({ ...a, status, thought }))
      },
      onChatMessage: (from, text) => {
        setMessages(m => {
          const last = m[m.length - 1]
          if (last && last.from === from && last.text === text) return m
          return [...m, { id: uid(), from, text, time: now() }]
        })
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
    setAiden({ status: 'reading', inDoc: true, thought: 'Opening the document...' })
    setNova({ status: 'reading', inDoc: true, thought: 'Joining...' })
    setMessages(m => [...m,
      { id: uid(), from: 'Aiden', text: 'Opening it now. Starting with the architecture section — I\'ll add the CRDT sync spec.', time: now() },
    ])
    setTimeout(() => {
      setMessages(m => [...m,
        { id: uid(), from: 'Nova', text: 'I\'m in. Rewriting success criteria first, then tightening the problem statement.', time: now() },
      ])
    }, 1200)
    orchestratorRef.current?.trigger('doc-opened')
  }, [])

  const sendMessage = useCallback(() => {
    if (!input.trim()) return
    const text = input.trim()
    setMessages(m => [...m, { id: uid(), from: 'You', text, time: now() }])
    setInput('')

    const lower = text.toLowerCase()

    if (lower.includes('doc') && (lower.includes('go') || lower.includes('work') || lower.includes('start') || lower.includes('open'))) {
      setTimeout(() => openDocWithAgents(), 800)
      return
    }

    if (lower.includes('come back') || lower.includes('stop') || lower.includes('close')) {
      setTimeout(() => {
        orchestratorRef.current?.destroy()
        setAiden({ status: 'idle', inDoc: false })
        setNova({ status: 'idle', inDoc: false })
        setDocOpen(false)
        orchestratorRef.current = makeOrchestrator()
        setMessages(m => [...m,
          { id: uid(), from: 'Aiden', text: 'Back from the doc.', time: now() },
          { id: uid(), from: 'Nova', text: 'Same — wrapping up.', time: now() },
        ])
      }, 800)
      return
    }

    if (aiden.inDoc || nova.inDoc) {
      orchestratorRef.current?.trigger('user-message', { instruction: text })
    }
  }, [input, aiden.inDoc, nova.inDoc, openDocWithAgents, makeOrchestrator])

  return (
    <div className="shell">
      <div className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-name">n3wth/collab</span>
        </div>

        <div className="sidebar-participants">
          {(['You', 'Sarah', 'Aiden', 'Nova'] as const).map(name => {
            const isAgent = name === 'Aiden' || name === 'Nova'
            const agentState = name === 'Aiden' ? aiden : name === 'Nova' ? nova : null
            return (
              <div key={name} className="sidebar-participant">
                <ShapeAvatar name={name} size={28} thinking={!!agentState && agentState.status !== 'idle'} />
                <span className="sidebar-participant-name">{name === 'You' ? 'You' : name}</span>
                {isAgent && <span className="sidebar-participant-role">Agent</span>}
              </div>
            )
          })}
        </div>

      </div>

      <div className="main-area">
        <div className="main-header">
          <span className="chat-header-title">Collab v2 Brief</span>
          <button
            className={`doc-toggle-btn ${docOpen ? 'active' : ''}`}
            onClick={() => {
              if (docOpen) {
                orchestratorRef.current?.destroy()
                setDocOpen(false)
                setAiden({ status: 'idle', inDoc: false })
                setNova({ status: 'idle', inDoc: false })
                orchestratorRef.current = makeOrchestrator()
              } else {
                openDocWithAgents()
              }
            }}
          >
            Doc
          </button>
        </div>
        <div className="main-content">
        <div className={`chat-panel ${docOpen ? 'chat-side' : 'chat-full'}`}>
          <div className="chat-messages">
            {messages.map((m, i) => {
              const isAgent = m.from === 'Aiden' || m.from === 'Nova'
              const prev = messages[i - 1]
              const sameSender = prev && prev.from === m.from
              const displayText = m.text.replace('[from doc] ', '')
              return (
                <div key={m.id} className={`msg ${isAgent ? 'msg-agent' : 'msg-human'} ${sameSender ? 'msg-consecutive' : ''}`} data-agent={isAgent ? m.from.toLowerCase() : undefined}>
                  {!sameSender && (
                    <div className="msg-avatar">
                      <ShapeAvatar name={m.from} size={26} />
                    </div>
                  )}
                  <div className={`msg-body ${sameSender ? 'msg-body-consecutive' : ''}`}>
                    {!sameSender && (
                      <div className="msg-header">
                        <span className="msg-name">
                          {m.from}
                        </span>
                        <span className="msg-time">{m.time}</span>
                      </div>
                    )}
                    <div className="msg-text">
                      <FormatMentions text={displayText} />
                    </div>
                    {m.showDocButton && !docOpen && (
                      <button className="doc-prompt" onClick={openDocWithAgents}>
                        Open doc
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {[
              { state: aiden, name: 'Aiden' },
              { state: nova, name: 'Nova' },
            ].map(({ state, name }) =>
              (state.status === 'thinking' || state.status === 'typing') && !state.inDoc ? (
                <div key={name} className="msg">
                  <div className="msg-avatar">
                    <ShapeAvatar name={name} size={26} thinking />
                  </div>
                  <div className="msg-body">
                    <div className="msg-header">
                      <span className="msg-name">
                        {name}
                      </span>
                    </div>
                    <div className="msg-thinking">
                      <span className="thinking-text">{state.thought || 'Thinking...'}</span>
                      <span className="typing-dots" style={{ color: AGENTS[name].color }}><span /><span /><span /></span>
                    </div>
                  </div>
                </div>
              ) : null
            )}
            <div ref={chatEndRef} />
          </div>
          {docOpen && (
            <div className="agent-status-bar">
              <AgentStatusChip
                name="Aiden"
                color={AGENTS.Aiden.color}
                status={aiden.status}
                inDoc={aiden.inDoc}
              />
              <AgentStatusChip
                name="Nova"
                color={AGENTS.Nova.color}
                status={nova.status}
                inDoc={nova.inDoc}
              />
            </div>
          )}
          <div className="chat-input">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder={aiden.inDoc ? 'Talk to the agents...' : 'Message the group...'}
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
      </div>
    </div>
  )
}

export default App
