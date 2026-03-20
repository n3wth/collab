import { useCallback, useRef, useEffect } from 'react'
import { createOrchestrator } from '../orchestrator'
import { saveChatMessage, updateSessionTitle } from '../lib/session-store'
import { events } from '../lib/analytics'
import type { AgentConfig, AgentState, Message, TimelineEntry, Session } from '../types'
import type { Editor } from '@tiptap/react'
import { now, uid } from './useSession'

interface UseOrchestratorOptions {
  editorRef: React.RefObject<Editor | null>
  messagesRef: React.RefObject<Message[]>
  activeAgents: AgentConfig[]
  activeSessionRef: React.RefObject<Session | null>
  agentsPausedRef: React.RefObject<boolean>
  orchestratorRef: React.MutableRefObject<ReturnType<typeof createOrchestrator> | null>
  setAgentStates: React.Dispatch<React.SetStateAction<Record<string, AgentState>>>
  setTimeline: React.Dispatch<React.SetStateAction<TimelineEntry[]>>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setActiveSession: React.Dispatch<React.SetStateAction<Session | null>>
}

export function useOrchestrator({
  editorRef,
  messagesRef,
  activeAgents,
  activeSessionRef,
  agentsPausedRef,
  orchestratorRef,
  setAgentStates,
  setTimeline,
  setMessages,
  setSessions,
  setActiveSession,
}: UseOrchestratorOptions) {
  const pendingReasoning = useRef<Record<string, string[]>>({})

  const makeOrchestrator = useCallback(() => {
    return createOrchestrator({
      getEditor: () => editorRef.current,
      getDocText: () => editorRef.current?.getText() || '',
      getMessages: () => messagesRef.current.slice(-10).map(m => ({ from: m.from, text: m.text })),
      agents: activeAgents,
      sessionTemplate: activeSessionRef.current?.template,
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
        const sessionId = activeSessionRef.current?.id || ''
        // Extract action type from description (e.g. "Aiden inserted content after:...")
        const actionType = description.match(/\b(insert|replace|read|image)\b/i)?.[1]?.toLowerCase() || 'edit'
        events.agentAction(sessionId, agent, actionType, true)
      },
      onChatMessage: (from, text) => {
        const reasoning = pendingReasoning.current[from]
        if (reasoning) delete pendingReasoning.current[from]
        setMessages(m => {
          const last = m[m.length - 1]
          if (last && last.from === from && last.text === text) return m
          const next = [...m, { id: uid(), from, text, time: now(), reasoning }]
          return next.length > 200 ? next.slice(-200) : next
        })
        const session = activeSessionRef.current
        if (session) {
          saveChatMessage(session.id, { sender: from, text, reasoning }).catch(err =>
            console.error('[App] saveChatMessage error:', err)
          )
        }
      },
      onProposal: (agent, proposalType, proposal) => {
        setMessages(prev => [...prev, {
          id: uid(),
          from: agent,
          text: proposal,
          time: now(),
          proposal: { type: proposalType as import('../types').Proposal['type'], description: proposal, status: 'pending' },
        }])
      },
      onRenameSession: (title) => {
        const session = activeSessionRef.current
        if (session) {
          updateSessionTitle(session.id, title).catch(console.error)
          setSessions(s => s.map(x => x.id === session.id ? { ...x, title } : x))
          setActiveSession(s => s ? { ...s, title } : s)
        }
      },
      onError: (agent, error, failures) => {
        const sessionId = activeSessionRef.current?.id || ''
        events.agentError(sessionId, agent, error.code)
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
  }, [activeAgents, editorRef, messagesRef, activeSessionRef, setAgentStates, setTimeline, setMessages, setSessions, setActiveSession])

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
  }, [makeOrchestrator, agentsPausedRef, orchestratorRef])

  return {
    makeOrchestrator,
  }
}
