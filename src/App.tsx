import { useState, useEffect, useRef, useCallback } from 'react'
import Avatar from 'boring-avatars'
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
  Aiden: { color: '#1a73e8', bgColor: '#e8f0fe' },
  Nova: { color: '#e37400', bgColor: '#fef7e0' },
}

const AGENT_PALETTES: Record<string, string[]> = {
  Aiden: ['#1a73e8', '#4285f4', '#8ab4f8', '#c5dafc', '#e8f0fe'],
  Nova: ['#e37400', '#f29900', '#fdd663', '#feefc3', '#fef7e0'],
}

const PERSON_PHOTOS: Record<string, string> = {
  You: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face',
  Sarah: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=face',
}

function AgentAvatar({ size = 28, name = 'Aiden', className = '' }: { size?: number, name?: string, className?: string }) {
  return (
    <div className={`avatar-wrapper ${className}`} style={{ width: size, height: size }}>
      <Avatar size={size} name={name} variant="beam" colors={AGENT_PALETTES[name] || AGENT_PALETTES.Aiden} />
    </div>
  )
}

function PersonAvatar({ name, className = '', size = 28 }: { name: string, className?: string, size?: number }) {
  const photo = PERSON_PHOTOS[name]
  if (photo) {
    return (
      <div className={`avatar-wrapper ${className}`} style={{ width: size, height: size }}>
        <img src={photo} alt={name} className="person-photo" style={{ width: size, height: size }} />
      </div>
    )
  }
  return (
    <div className={`avatar-wrapper ${className}`} style={{ width: size, height: size }}>
      <Avatar size={size} name={name} variant="marble" colors={['#e8f0fe', '#4285f4', '#34a853', '#ea4335', '#fbbc04']} />
    </div>
  )
}

function MessageAvatar({ from, size = 28 }: { from: string, size?: number }) {
  if (from === 'Aiden' || from === 'Nova') return <AgentAvatar size={size} name={from} />
  return <PersonAvatar name={from} size={size} />
}

function AgentStatusChip({ name, color, status, inDoc }: {
  name: string, color: string, status: AgentState['status'], inDoc: boolean
}) {
  const isVisible = inDoc && status !== 'idle'
  if (!isVisible) return null

  const label = status === 'reading' ? 'reading' : status === 'thinking' ? 'thinking' : 'writing'
  const statusClass = status === 'reading' ? 'status-chip-reading' : status === 'thinking' ? 'status-chip-thinking' : 'status-chip-writing'

  return (
    <div className={`status-chip ${statusClass}`} style={{ borderColor: color + '50', background: color + '08' }}>
      <div className="status-chip-avatar-wrap">
        <AgentAvatar size={20} name={name} />
        <span className="status-chip-ring" style={{ borderColor: color }} />
      </div>
      <span className="status-chip-label status-chip-label-active" style={{ color }}>
        {label}
      </span>
    </div>
  )
}

const ALL_NAMES = [...Object.keys(AGENTS), ...Object.keys(PERSON_PHOTOS).filter(n => n !== 'You')]
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

const INITIAL_DOC = `<h1>Project Proposal: Ambient AI Companions</h1>
<h2>Overview</h2>
<p>Personal AI agents that persist across contexts — chat, docs, browsing — maintaining continuity of thought and conversation. Each person has their own agent with distinct capabilities, and agents collaborate alongside humans in shared workspaces.</p>
<h2>Key Ideas</h2>
<ul>
<li>Agent has visible presence (avatar, status, cursor in docs)</li>
<li>Thinking is transparent, not hidden behind a loading spinner</li>
<li>Agent follows you across tools and contexts</li>
<li>Others in the group can see your agent working in real time</li>
<li>Multiple agents with different expertise can work on the same artifact simultaneously</li>
</ul>
<h2>Technical Architecture</h2>
<p>Needs detailed design: state management, cross-context persistence, real-time sync protocol.</p>
<h2>User Experience</h2>
<p>How do users build trust with their agent? What does onboarding look like? When should the agent proactively act vs wait?</p>
<h2>Open Questions</h2>
<ul>
<li>How does the agent know when to speak vs listen?</li>
<li>What does "presence" look like in a doc vs chat?</li>
<li>How do we handle conflicting edits between agents?</li>
<li>What's the trust-building arc for new users?</li>
</ul>`

function App() {
  const [docOpen, setDocOpen] = useState(false)
  const [aiden, setAiden] = useState<AgentState>({ status: 'idle', inDoc: false })
  const [nova, setNova] = useState<AgentState>({ status: 'idle', inDoc: false })
  const [messages, setMessages] = useState<Message[]>([
    { id: uid(), from: 'You', text: 'the proposal doc needs work before Thursday — can you two jump in?', time: '2:41 PM' },
    { id: uid(), from: 'Sarah', text: 'agreed. the open questions section is basically empty and the architecture is hand-wavy', time: '2:41 PM' },
    { id: uid(), from: 'Aiden', text: 'I\'ll take technical architecture. Needs a real system design, not placeholders — data model, sync protocol, component boundaries.', time: '2:42 PM', showDocButton: true },
    { id: uid(), from: 'Nova', text: 'I\'ll own the product side. The trust-building arc Sarah flagged is critical — users won\'t adopt this if the agent feels unpredictable. Let me write that up.', time: '2:42 PM' },
  ])
  const [input, setInput] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)
  const orchestratorRef = useRef<ReturnType<typeof createOrchestrator> | null>(null)
  const editorRef = useRef<Editor | null>(null)
  messagesRef.current = messages

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing...' }),
      AgentCursors,
    ],
    content: INITIAL_DOC,
    editorProps: {
      attributes: {
        class: 'doc-editor',
      },
    },
  })
  editorRef.current = editor

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

  // Create orchestrator on mount
  useEffect(() => {
    const orch = makeOrchestrator()
    orchestratorRef.current = orch
    return () => {
      orch.destroy()
      orchestratorRef.current = null
    }
  }, [makeOrchestrator])

  // Watch for agent-to-agent tagging in new messages
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
      { id: uid(), from: 'Aiden', text: 'Opening it now. I\'ll start under Technical Architecture.', time: now() },
    ])
    setTimeout(() => {
      setMessages(m => [...m,
        { id: uid(), from: 'Nova', text: 'I\'m in too. Starting from the bottom — user experience and the open questions.', time: now() },
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
  }, [input, aiden.inDoc, nova.inDoc, openDocWithAgents])

  return (
    <div className="shell">
      <div className="top-bar">
        <span className="top-bar-title">n3wth/collab</span>
        <div className="participants">
          <PersonAvatar name="You" size={30} />
          <div style={{ position: 'relative' }}>
            <AgentAvatar size={26} name="Aiden" />
            <span className={`avatar-status ${aiden.inDoc ? 'status-working' : aiden.status !== 'idle' ? 'status-active' : ''}`} />
          </div>
          <PersonAvatar name="Sarah" size={30} />
          <div style={{ position: 'relative' }}>
            <AgentAvatar size={26} name="Nova" />
            <span className={`avatar-status ${nova.inDoc ? 'status-working' : nova.status !== 'idle' ? 'status-active' : ''}`} />
          </div>
        </div>
      </div>

      <div className="main-area">
        <div className={`chat-panel ${docOpen ? 'chat-side' : 'chat-full'}`}>
          <div className="chat-header">
            Group Chat
          </div>
          <div className="chat-messages">
            {messages.map(m => {
              const isAgent = m.from === 'Aiden' || m.from === 'Nova'
              const ownerLabel = m.from === 'Aiden' ? 'your agent' : m.from === 'Nova' ? 'Sarah\'s agent' : ''
              const agent = isAgent ? AGENTS[m.from] : null
              return (
                <div key={m.id} className="msg">
                  <div className="msg-avatar">
                    <MessageAvatar from={m.from} size={28} />
                  </div>
                  <div className="msg-body">
                    <div className="msg-header">
                      <span className="msg-name" style={agent ? { color: agent.color } : undefined}>
                        {m.from}
                      </span>
                      {ownerLabel && <span className="msg-owner-tag">{ownerLabel}</span>}
                      <span className="msg-time">{m.time}</span>
                    </div>
                    <div className="msg-text">
                      {m.text.startsWith('[from doc]') && <span className="msg-remote-badge">from doc</span>}
                      <FormatMentions text={m.text.replace('[from doc] ', '')} />
                    </div>
                    {m.showDocButton && !docOpen && (
                      <button className="doc-prompt" onClick={openDocWithAgents}>
                        <svg className="doc-prompt-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="#1a73e8" opacity="0.15" stroke="#1a73e8" strokeWidth="1.5" strokeLinejoin="round"/><path d="M14 2v6h6" stroke="#1a73e8" strokeWidth="1.5" strokeLinejoin="round"/><path d="M8 13h8M8 17h5" stroke="#1a73e8" strokeWidth="1.5" strokeLinecap="round"/></svg>
                        Open doc
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {[
              { state: aiden, name: 'Aiden', label: 'your agent' },
              { state: nova, name: 'Nova', label: "Sarah's agent" },
            ].map(({ state, name, label }) =>
              (state.status === 'thinking' || state.status === 'typing') && !state.inDoc ? (
                <div key={name} className="msg">
                  <div className="msg-avatar">
                    <AgentAvatar size={28} name={name} />
                  </div>
                  <div className="msg-body">
                    <div className="msg-header">
                      <span className="msg-name" style={{ color: AGENTS[name].color }}>{name}</span>
                      <span className="msg-owner-tag">{label}</span>
                    </div>
                    <div className="msg-thinking">
                      <span className="thinking-text">{state.thought || 'Thinking...'}</span>
                      <span className="typing-dots"><span /><span /><span /></span>
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
              placeholder={aiden.inDoc ? 'Talk to the agents — they\'re listening' : 'Message the group...'}
            />
            <button className="send-btn" onClick={sendMessage} aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/></svg>
            </button>
          </div>
        </div>

        {docOpen && (
          <div className="doc-panel">
            <div className="doc-toolbar">
              <span className="doc-toolbar-title">Project Proposal</span>
              <div className="doc-toolbar-collabs">
                <span className="collab-count">4 in doc</span>
              </div>
              <button className="doc-close" onClick={() => {
                orchestratorRef.current?.destroy()
                setDocOpen(false)
                setAiden({ status: 'idle', inDoc: false })
                setNova({ status: 'idle', inDoc: false })
                orchestratorRef.current = makeOrchestrator()
              }}>
                &times;
              </button>
            </div>
            <div className="doc-body">
              <EditorContent editor={editor} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
