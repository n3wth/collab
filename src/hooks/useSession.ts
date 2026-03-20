import { useState, useRef, useCallback, useEffect } from 'react'
import { listSessions, getSession, createSession, loadDocument, loadChatMessages, loadAgentPersonas, saveAgentPersonas, saveDocument } from '../lib/session-store'
import { DOC_TEMPLATES } from '../templates'
import { supabase } from '../lib/supabase'
import { DEFAULT_PERSONAS } from '../agent'
import { agentConfigsToPersonas } from '../components/SessionHeader'
import { events } from '../lib/analytics'
import type { Session, AgentConfig, Message, AgentState } from '../types'
import type { Editor } from '@tiptap/react'
import type { GoogleDocFile } from '../TemplatePickerModal'

const DEFAULT_AGENT_CONFIGS: AgentConfig[] = [
  { name: 'Aiden', persona: DEFAULT_PERSONAS.Aiden, owner: 'You', color: '#30d158' },
  { name: 'Nova', persona: DEFAULT_PERSONAS.Nova, owner: 'Sarah', color: '#ff6961' },
]

export { DEFAULT_AGENT_CONFIGS }

function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function uid() {
  return Math.random().toString(36).slice(2, 9)
}

export { now, uid }

interface UseSessionOptions {
  editor: Editor | null
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setTimeline: React.Dispatch<React.SetStateAction<import('../types').TimelineEntry[]>>
  setAgentStates: React.Dispatch<React.SetStateAction<Record<string, AgentState>>>
  setSaveStatus: React.Dispatch<React.SetStateAction<'saved' | 'saving' | 'idle'>>
  lastDocSnapshot: React.MutableRefObject<string>
  lastProcessedMsg: React.MutableRefObject<number>
  orchestratorRef: React.RefObject<ReturnType<typeof import('../orchestrator').createOrchestrator> | null>
  messagesRef: React.RefObject<Message[]>
}

export function useSession({
  editor,
  setMessages,
  setTimeline,
  setAgentStates,
  setSaveStatus,
  lastDocSnapshot,
  lastProcessedMsg,
  orchestratorRef,
  messagesRef,
}: UseSessionOptions) {
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const activeSessionRef = useRef<Session | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [activeAgents, setActiveAgents] = useState<AgentConfig[]>(DEFAULT_AGENT_CONFIGS)

  // Load sessions list on mount
  useEffect(() => {
    listSessions()
      .then(s => { setSessions(s); setSessionsLoaded(true) })
      .catch(() => setSessionsLoaded(true))
  }, [])

  const refreshSessions = useCallback(() => {
    listSessions().then(setSessions).catch(console.error)
  }, [])

  const navigateToSession = useCallback((session: Session) => {
    history.pushState({ sessionId: session.id }, '', `/s/${session.id}`)
    window.scrollTo(0, 0)
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
    events.sessionOpened(session.id, session.template)
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
      currentAgents = agents.length > 0 ? agents : DEFAULT_AGENT_CONFIGS
      setActiveAgents(currentAgents)
      saveAgentPersonas(session.id, agentConfigsToPersonas(currentAgents))
        .catch(err => console.error('[App] saveAgentPersonas error:', err))
    }

    if (savedDoc && editor) {
      editor.commands.setContent(savedDoc)
    } else {
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
      // Welcome message if chat is empty
      if (messagesRef.current.length === 0 && currentAgents.length > 0) {
        const lead = currentAgents[0]
        const roles = currentAgents.map(a => {
          const role = a.persona.split('.')[0].replace(/^You are \w+, /, '')
          return `${a.name} (${role})`
        }).join(', ')
        setMessages(prev => {
          if (prev.length > 0) return prev
          return [{ id: uid(), from: lead.name, text: `Ready to collaborate. Your team: ${roles}. @mention any of us, or just start writing and we'll review as you go.`, time: now() }]
        })
      }
    }, 300)
    refreshSessions()
  }

  const handleTemplatePick = async (starter: { title: string, template: import('../types').DocTemplate, agents: AgentConfig[] }) => {
    const session = await createSession(starter.title, starter.template)
    events.sessionCreated(starter.template, starter.agents.length)
    events.templatePicked(starter.template, starter.agents.map(a => a.name))
    return handleSessionSelect(session, starter.agents)
  }

  const handleGoogleImport = async (file: GoogleDocFile) => {
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const token = authSession?.provider_token
      if (!token) {
        alert('Google session expired. Please sign out and back in.')
        return
      }

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
      const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)
      let html = bodyMatch ? bodyMatch[1] : rawHtml
      html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      html = html.replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, '')
      html = html.replace(/\s+(class|style|id|data-[a-z-]+)="[^"]*"/gi, '')
      html = html.trim()

      const title = file.name.replace(/\.gdoc$|\.docx?$/i, '')
      const session = await createSession(title, 'blank')

      await saveDocument(session.id, html)

      handleSessionSelect(session, [])
    } catch (err) {
      console.error('[import] error:', err)
      alert('Import failed. Check console for details.')
    }
  }

  const resetToHome = useCallback(() => {
    setActiveSession(null)
    activeSessionRef.current = null
    setAgentStates({})
    setMessages([])
    setTimeline([])
    setSaveStatus('idle')
    history.pushState(null, '', '/')
  }, [setMessages, setTimeline, setAgentStates, setSaveStatus])

  // URL routing: load session from URL on mount + popstate handling
  useEffect(() => {
    const match = window.location.pathname.match(/^\/s\/([a-f0-9-]+)$/)
    if (match) {
      const sessionId = match[1]
      getSession(sessionId).then(session => {
        if (session) handleSessionSelect(session, [])
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

  // Sync page title
  useEffect(() => {
    document.title = activeSession?.title
      ? `${activeSession.title} — Markup`
      : 'Markup'
  }, [activeSession?.title])

  return {
    activeSession,
    setActiveSession,
    activeSessionRef,
    sessions,
    setSessions,
    sessionsLoaded,
    activeAgents,
    setActiveAgents,
    handleSessionSelect,
    handleTemplatePick,
    handleGoogleImport,
    resetToHome,
    refreshSessions,
  }
}
