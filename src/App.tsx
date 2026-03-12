import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { AgentCursors } from './agent-cursor'
import { createOrchestrator } from './orchestrator'
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

const AGENTS: Record<string, { color: string, bgColor: string }> = {
  Aiden: { color: '#5f6368', bgColor: '#f1f3f5' },
  Nova: { color: '#5f6368', bgColor: '#f1f3f5' },
}

function ShapeAvatar({ name, size = 28, className = '' }: { name: string, size?: number, className?: string }) {
  const color = '#1a1a1a'
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

const ALL_NAMES = [...Object.keys(AGENTS), 'Sarah']
const mentionRegex = new RegExp(`(@?(?:${ALL_NAMES.join('|')}))(?=\\s|$|[.,!?;:])`, 'gi')

const FormatMentions = memo(({ text }: { text: string }) => {
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
})


const ChatMessage = memo(({ m, sameSender, docOpen, onOpenDoc }: {
  m: Message, sameSender: boolean, docOpen: boolean, onOpenDoc: () => void
}) => {
  const isAgent = m.from === 'Aiden' || m.from === 'Nova'
  const displayText = m.text.replace('[from doc] ', '')
  return (
    <div className={`msg ${isAgent ? 'msg-agent' : 'msg-human'} ${sameSender ? 'msg-consecutive' : ''}`} data-agent={isAgent ? m.from.toLowerCase() : undefined}>
      {!sameSender && (
        <div className="msg-avatar">
          {isAgent ? (
            <BlobAvatar name={m.from} size={26} />
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
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const MENTION_NAMES = ['Aiden', 'Nova', 'Sarah']
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

  const pendingReasoning = useRef<Record<string, string[]>>({})

  const makeOrchestrator = useCallback(() => {
    return createOrchestrator({
      getEditor: () => editorRef.current,
      getDocText: () => editorRef.current?.getText() || '',
      getMessages: () => messagesRef.current.slice(-10).map(m => ({ from: m.from, text: m.text })),
      onAgentState: (agent, status, thought) => {
        const setter = agent === 'Aiden' ? setAiden : setNova
        setter(a => ({ ...a, status, thought }))
      },
      onAgentReasoning: (agent, reasoning) => {
        pendingReasoning.current[agent] = reasoning
      },
      onChatMessage: (from, text) => {
        const reasoning = pendingReasoning.current[from]
        if (reasoning) delete pendingReasoning.current[from]
        setMessages(m => {
          const last = m[m.length - 1]
          if (last && last.from === from && last.text === text) return m
          return [...m, { id: uid(), from, text, time: now(), reasoning }]
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

  const resetSession = useCallback(() => {
    orchestratorRef.current?.destroy()
    setDocOpen(false)
    setAiden({ status: 'idle', inDoc: false })
    setNova({ status: 'idle', inDoc: false })
    try {
      localStorage.removeItem(STORAGE_KEYS.doc)
      localStorage.removeItem(STORAGE_KEYS.chat)
    } catch { /* skip */ }
    editor?.commands.setContent(INITIAL_DOC)
    lastDocSnapshot.current = editor?.getText() || ''
    setMessages([
      { id: uid(), from: 'You', text: 'the v2 brief needs to be ready for the board review Friday. can you two get in there and tighten it up?', time: '2:41 PM' },
      { id: uid(), from: 'Sarah', text: 'yeah the architecture section is still too vague and we need real success metrics, not aspirational ones', time: '2:41 PM' },
      { id: uid(), from: 'Aiden', text: 'I\'ll take architecture and the technical open questions. The sync protocol needs specifics — I\'ll spec out the CRDT approach and agent coordination model.', time: '2:42 PM', showDocButton: true },
      { id: uid(), from: 'Nova', text: 'I\'ll sharpen the problem statement and success criteria. Sarah\'s right — "users trust the agent" isn\'t measurable. I\'ll define concrete thresholds.', time: '2:42 PM' },
    ])
    lastProcessedMsg.current = 4
    orchestratorRef.current = makeOrchestrator()
  }, [editor, makeOrchestrator])

  return (
    <div className="shell">
      <div className="main-area">
        <div className="main-header">
          <span className="chat-header-title">Collab v2 Brief</span>
          <div className="header-participants">
            {(['You', 'Sarah', 'Aiden', 'Nova'] as const).map(name => {
              const isAgent = name === 'Aiden' || name === 'Nova'
              const agentState = name === 'Aiden' ? aiden : name === 'Nova' ? nova : null
              return (
                <div key={name} className="header-avatar-wrap">
                  {isAgent ? (
                    <BlobAvatar name={name} size={24} state={agentState?.status} />
                  ) : (
                    <ShapeAvatar name={name} size={24} />
                  )}
                  {isAgent && (
                    <div className="agent-hover-card">
                      <div className="agent-hover-card-header">
                        <BlobAvatar name={name} size={32} state={agentState?.status} />
                        <div>
                          <div className="agent-hover-card-name">{name}</div>
                          <div className="agent-hover-card-role">AI Agent</div>
                        </div>
                      </div>
                      <div className="agent-hover-card-status">
                        <span className={`agent-hover-card-dot ${agentState?.status !== 'idle' ? 'active' : ''}`} />
                        {agentState?.status === 'idle' ? 'Idle' : agentState?.thought || agentState?.status}
                      </div>
                      {agentState?.inDoc && <div className="agent-hover-card-location">In document</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="header-buttons">
            <button className="reset-btn" onClick={resetSession}>Reset</button>
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
        </div>
        <div className="main-content">
        <div className={`chat-panel ${docOpen ? 'chat-side' : 'chat-full'}`}>
          <div className="chat-messages">
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const sameSender = prev && prev.from === m.from
              return (
                <ChatMessage key={m.id} m={m} sameSender={sameSender} docOpen={docOpen} onOpenDoc={openDocWithAgents} />
              )
            })}
            {[
              { state: aiden, name: 'Aiden' as const },
              { state: nova, name: 'Nova' as const },
            ].map(({ state, name }) =>
              (state.status === 'thinking' || state.status === 'typing') && !state.inDoc ? (
                <div key={name} className="msg">
                  <div className="msg-avatar">
                    <BlobAvatar name={name} size={26} state={state.status} />
                  </div>
                  <div className="msg-body">
                    <div className="msg-header">
                      <span className="msg-name">
                        {name}
                      </span>
                    </div>
                    <div className="msg-thinking">
                      <span className="thinking-text">{state.thought || 'Thinking...'}</span>
                    </div>
                  </div>
                </div>
              ) : null
            )}
            <div ref={chatEndRef} />
          </div>
          {docOpen && (
            <div className="agent-status-bar">
              <AgentStatusBlob name="Aiden" status={aiden.status} inDoc={aiden.inDoc} />
              <AgentStatusBlob name="Nova" status={nova.status} inDoc={nova.inDoc} />
            </div>
          )}
          <div className="chat-input">
            {mentionQuery !== null && (() => {
              const filtered = MENTION_NAMES.filter(n => n.toLowerCase().startsWith(mentionQuery.toLowerCase()))
              if (filtered.length === 0) return null
              return (
                <div className="mention-dropdown">
                  {filtered.map((n, i) => (
                    <div
                      key={n}
                      className={`mention-option ${i === mentionIndex ? 'mention-option-active' : ''}`}
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
                    const pick = filtered[mentionIndex] || filtered[0]
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
