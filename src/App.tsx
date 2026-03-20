import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { AgentCursors } from './agent-cursor'
import { DocMinimap } from './doc-minimap'
import { Sidebar } from './Sidebar'
import { CommandPalette, type Command } from './CommandPalette'
import { invalidateApiKeyCache } from './AgentConfigurator'
import { loadUserSettings, saveGeminiApiKey } from './lib/settings-store'

// Lazy-loaded components (not needed on initial render)
const LoginPage = lazy(() => import('./LoginPage').then(m => ({ default: m.LoginPage })))
const LegalPage = lazy(() => import('./LegalPage').then(m => ({ default: m.LegalPage })))
const TemplatePickerModal = lazy(() => import('./TemplatePickerModal').then(m => ({ default: m.TemplatePickerModal })))
import type { GoogleDocFile } from './TemplatePickerModal'
const SettingsModal = lazy(() => import('./SettingsModal').then(m => ({ default: m.SettingsModal })))
import { saveDocument, updateSessionTitle, saveChatMessage } from './lib/session-store'
import { identify, events } from './lib/analytics'
import { useAuth } from './lib/auth'
import type { Session, AgentState, TimelineEntry } from './types'
const ColorPanels = lazy(() => import('@paper-design/shaders-react').then(m => ({ default: m.ColorPanels })))
import './App.css'

// Extracted components
import { SessionHeader } from './components/SessionHeader'
import { EditorPanel } from './components/EditorPanel'
import { ChatPanel } from './components/ChatPanel'
import { ErrorBoundary } from './components/ErrorBoundary'

// Custom hooks
import { useOrchestrator } from './hooks/useOrchestrator'
import { useSession, now, uid } from './hooks/useSession'


const EMPTY_DOC = '<h1>Untitled</h1><p></p>'

function App() {
  const { user, loading: authLoading, signOut, providerToken, signInWithGoogle } = useAuth()

  // PostHog user identification (init handled by PostHogProvider in main.tsx)
  useEffect(() => {
    if (user) identify(user.id, { email: user.email })
  }, [user])

  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [chatWidth, setChatWidth] = useState(340)
  const [agentsPaused, setAgentsPaused] = useState(false)
  const agentsPausedRef = useRef(false)
  const resizingRef = useRef<'sidebar' | 'chat' | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle')
  const [showConfigurator, setShowConfigurator] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [driveStatus, setDriveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({})
  const getAgentState = (name: string): AgentState => agentStates[name] || { status: 'idle', inDoc: false }
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const editorRef = useRef<import('@tiptap/react').Editor | null>(null)
  const docSaveTimer = useRef<number | null>(null)
  const docEditTimer = useRef<number | null>(null)
  const lastDocSnapshot = useRef('')

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing here. Your AI team will review as you go.' }),
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

  // Chat state
  const [messages, setMessages] = useState<import('./types').Message[]>([])
  const [input, setInput] = useState('')
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const lastProcessedMsg = useRef(0)

  // Stable orchestrator ref -- shared between useSession and useOrchestrator
  const orchestratorRef = useRef<ReturnType<typeof import('./orchestrator').createOrchestrator> | null>(null)

  // Session hook
  const {
    activeSession, setActiveSession, activeSessionRef,
    sessions, setSessions, sessionsLoaded,
    activeAgents, setActiveAgents,
    handleSessionSelect, handleTemplatePick, handleGoogleImport,
    resetToHome,
  } = useSession({
    editor,
    setMessages,
    setTimeline,
    setAgentStates,
    setSaveStatus,
    lastDocSnapshot,
    lastProcessedMsg,
    orchestratorRef,
    messagesRef,
  })

  // Orchestrator hook -- populates orchestratorRef
  const { makeOrchestrator } = useOrchestrator({
    editorRef,
    messagesRef,
    activeAgents,
    activeSessionRef,
    agentsPausedRef,
    setAgentStates,
    setTimeline,
    setMessages,
    setSessions,
    setActiveSession,
    orchestratorRef,
  })

  // Forward new messages to orchestrator
  useEffect(() => {
    const newMsgs = messages.slice(lastProcessedMsg.current)
    lastProcessedMsg.current = messages.length
    for (const m of newMsgs) {
      orchestratorRef.current?.onMessage(m.from, m.text)
    }
  }, [messages, orchestratorRef])

  const handleSendMessage = useCallback(() => {
    if (!input.trim()) return
    const text = input.trim()
    setMessages(m => [...m, { id: uid(), from: 'You', text, time: now() }])
    setInput('')
    const session = activeSessionRef.current
    if (session) {
      saveChatMessage(session.id, { sender: 'You', text }).catch(err =>
        console.error('[App] saveChatMessage error:', err)
      )
    }
    const mentioned = activeAgents.filter(a => text.toLowerCase().includes(a.name.toLowerCase())).map(a => a.name)
    events.messageSent(session?.id || '', mentioned)
    orchestratorRef.current?.trigger('user-message', { instruction: text })
  }, [input, activeSessionRef, orchestratorRef, activeAgents])

  const handleSendSuggestion = useCallback((text: string) => {
    setMessages(m => [...m, { id: uid(), from: 'You', text, time: now() }])
    setInput('')
    const session = activeSessionRef.current
    if (session) {
      saveChatMessage(session.id, { sender: 'You', text }).catch(err =>
        console.error('[App] saveChatMessage error:', err)
      )
    }
    orchestratorRef.current?.trigger('user-message', { instruction: text })
  }, [activeSessionRef, orchestratorRef])

  // Cmd+N to create new doc, Cmd+K for command palette
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

  // Load user settings (API key) on auth
  useEffect(() => {
    if (user) {
      loadUserSettings(user.id).then(settings => {
        const key = settings.gemini_api_key || ''
        setGeminiApiKey(key)
        if (key) { localStorage.setItem('collab-gemini-api-key', key); invalidateApiKeyCache() }
      })
    } else {
      setGeminiApiKey(localStorage.getItem('collab-gemini-api-key') || '')
    }
  }, [user])

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

  const handleTogglePause = useCallback(() => {
    setAgentsPaused(v => {
      const next = !v
      agentsPausedRef.current = next
      if (next) {
        orchestratorRef.current?.destroy()
        orchestratorRef.current = null
        setAgentStates({})
      } else {
        const orch = makeOrchestrator()
        orchestratorRef.current = orch
        orch.trigger('doc-opened')
      }
      return next
    })
  }, [makeOrchestrator, orchestratorRef, setAgentStates])

  // Legal pages -- accessible without auth
  if (window.location.pathname === '/privacy') return <Suspense><LegalPage page="privacy" /></Suspense>
  if (window.location.pathname === '/terms') return <Suspense><LegalPage page="terms" /></Suspense>

  // Login page for unauthenticated users (non-localhost)
  if (!isLocalhost && authLoading) {
    return <div className="app-shell" style={{ background: 'var(--surface-0)' }} />
  }

  if (params.has('login') || (!isLocalhost && !user)) {
    return <Suspense><LoginPage /></Suspense>
  }

  return (
    <div className={`app-shell ${activeSession ? 'app-shell-active' : ''}`}>
      <div className="app-layout">
      <div className="app-sidebar-column" style={{ width: sidebarCollapsed ? 0 : sidebarWidth, flexShrink: 0, overflow: 'hidden' }}>
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSession?.id ?? null}
          onSelect={(session: Session) => handleSessionSelect(session, [])}
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
          onSettings={() => setShowSettings(true)}
        />
      </div>
      {!sidebarCollapsed && activeSession && (
        <div className="resize-handle" onMouseDown={() => startResize('sidebar')} />
      )}
      <div className="app-main-column">
      {activeSession && (
        <SessionHeader
          activeSession={activeSession}
          activeAgents={activeAgents}
          getAgentState={getAgentState}
          agentsPaused={agentsPaused}
          onTogglePause={handleTogglePause}
          chatWidth={chatWidth}
          saveStatus={saveStatus}
          showConfigurator={showConfigurator}
          onToggleConfigurator={() => setShowConfigurator(v => !v)}
          onAgentsChange={setActiveAgents}
          activeSessionRef={activeSessionRef}
        />
      )}
      <div className="app-body">
        {activeSession ? (
          <div className="workspace-area">
            <div className="workspace-content">
            {editor && (
              <ErrorBoundary>
                <EditorPanel
                  editor={editor}
                  timeline={timeline}
                  activeSession={activeSession}
                  driveStatus={driveStatus}
                  setDriveStatus={setDriveStatus}
                  user={user}
                  providerToken={providerToken}
                  signInWithGoogle={signInWithGoogle}
                  setMessages={setMessages}
                  now={now}
                  uid={uid}
                />
              </ErrorBoundary>
            )}
            <div className="resize-handle" onMouseDown={() => startResize('chat')} />
            <ErrorBoundary>
              <ChatPanel
                messages={messages}
                activeAgents={activeAgents}
                getAgentState={getAgentState}
                userAvatarUrl={user?.user_metadata?.avatar_url}
                input={input}
                onInputChange={setInput}
                onSend={handleSendMessage}
                onSendSuggestion={handleSendSuggestion}
                onApproveProposal={(id) => {
                  setMessages(prev => prev.map(msg => msg.id === id && msg.proposal ? { ...msg, proposal: { ...msg.proposal, status: 'approved' as const } } : msg))
                  const msg = messages.find(x => x.id === id)
                  if (msg?.proposal?.type === 'create-doc') setShowTemplatePicker(true)
                }}
                onRejectProposal={(id) => {
                  setMessages(prev => prev.map(msg => msg.id === id && msg.proposal ? { ...msg, proposal: { ...msg.proposal, status: 'rejected' as const } } : msg))
                }}
                chatWidth={chatWidth}
              />
            </ErrorBoundary>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-shader">
              <img src="/hero-bg.jpg" alt="" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7, zIndex: 0 }} />
              <Suspense fallback={null}>
                <ColorPanels speed={0.5} scale={1.15} density={3} angle1={0} angle2={0} length={1.1} edges={false} blur={0} fadeIn={1} fadeOut={0.3} gradient={0} rotation={0} offsetX={0} offsetY={0} maxPixelCount={1920 * 1080} minPixelRatio={1} colors={['#FF9D00', '#FD4F30', '#809BFF', '#6D2EFF', '#333AFF', '#F15CFF', '#FFD557']} colorBack="#00000000" style={{ height: '100%', width: '100%', mixBlendMode: 'screen' }} />
              </Suspense>
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
      {showSettings && (
        <Suspense>
          <SettingsModal
            apiKey={geminiApiKey}
            onSave={async (key) => {
              if (user) await saveGeminiApiKey(user.id, key)
              localStorage.setItem('collab-gemini-api-key', key)
              invalidateApiKeyCache()
              setGeminiApiKey(key)
            }}
            onClose={() => setShowSettings(false)}
          />
        </Suspense>
      )}
      {showTemplatePicker && (
        <Suspense>
          <TemplatePickerModal
            onSelect={(starter) => {
              setShowTemplatePicker(false)
              handleTemplatePick(starter)
            }}
            onImport={(file: GoogleDocFile) => {
              setShowTemplatePicker(false)
              handleGoogleImport(file)
            }}
            onClose={() => setShowTemplatePicker(false)}
            importAvailable={!!user}
          />
        </Suspense>
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
            { id: 'help', label: 'Agent help — what can agents do?', shortcut: '?', action: () => {
              const helpText = activeAgents.map(a => {
                const role = a.persona.split('.')[0].replace(/^You are \w+, /, '')
                return `${a.name}: ${role}`
              }).join('\n')
              setMessages(prev => [...prev, {
                id: uid(),
                from: 'System',
                text: `Your AI team:\n${helpText}\n\nAgents can: edit documents, chat, search the web, rename docs, and observe document quality. @mention any agent to direct them.`,
                time: now(),
              }])
            }},
            ...(!isLocalhost && user ? [{ id: 'signout', label: 'Sign out', action: signOut }] as Command[] : []),
          ]}
        />
      )}
    </div>
  )
}

export default App
