import type { Editor } from '@tiptap/react'
import { askAgent, AgentError, resetRateLimiter, extractDocStructure, type AgentAction, type AskParams } from './agent'
import { executeAgentAction, type ActionCallbacks } from './agent-actions'
import { generateObservation, resetHeartbeat } from './heartbeat'
import { classifyDocState, type DocState } from './templates'
import { DEFAULT_LIMITS, type OrchestratorLimits, type AgentConfig } from './types'
import { type PhaseState, initialPhaseState, phaseReducer, isActionAllowed } from './phase-machine'
import { getAgentMode } from './agent-modes'

export type { AgentConfig }

type AgentName = string
type TriggerType = 'doc-opened' | 'user-message' | 'agent-tagged' | 'turn-complete' | 'heartbeat'

interface TurnRequest {
  agent: AgentName
  trigger: AskParams['trigger']
  instruction?: string
}

interface OrchestratorConfig {
  getEditor: () => Editor | null
  getDocText: () => string
  getMessages: () => { from: string, text: string }[]
  onAgentState: (agent: AgentName, status: 'idle' | 'thinking' | 'typing' | 'reading' | 'editing', thought?: string) => void
  onChatMessage: (from: string, text: string) => void
  onAgentReasoning?: (agent: AgentName, reasoning: string[]) => void
  onDocAction?: (agent: AgentName, description: string) => void
  onError?: (agent: AgentName, error: AgentError, consecutiveFailures: number) => void
  onSearchRequest?: (agent: AgentName, query: string) => void
  agents: AgentConfig[]
  demoMode?: boolean
  limits?: Partial<OrchestratorLimits>
  sessionTemplate?: string
  onRenameSession?: (newTitle: string) => void
  onProposal?: (agent: AgentName, proposalType: string, proposal: string) => void
  onPhaseChange?: (phase: PhaseState) => void
}

interface OrchestratorHandle {
  trigger: (type: TriggerType, payload?: { agent?: AgentName, instruction?: string, from?: string }) => void
  onMessage: (from: string, text: string) => void
  destroy: () => void
}

function log(...args: unknown[]) {
  console.log('[orch]', ...args)
}

export function createOrchestrator(config: OrchestratorConfig): OrchestratorHandle {
  const queue: TurnRequest[] = []
  let processing = false
  let destroyed = false
  const editorLockRef: { current: string | null } = { current: null }
  const typingTimers: Record<string, number> = {}
  const pendingInstructions: Record<string, { trigger: AskParams['trigger'], instruction: string }> = {}
  let lastActionDescription: Record<string, string> = {}
  const agentNames = config.agents.map(a => a.name)
  function getAgentConfig(name: string) { return config.agents.find(a => a.name === name) }

  // Merge limits with defaults (demoMode overrides)
  const baseLimits = { ...DEFAULT_LIMITS, ...config.limits }
  const limits = config.demoMode
    ? { ...baseLimits, maxTurns: Math.max(baseLimits.maxTurns, 6), maxExchanges: Math.max(baseLimits.maxExchanges, 6) }
    : baseLimits

  // Track total turns per agent (caps all non-user-initiated work)
  const turnCount: Record<string, number> = Object.fromEntries(config.agents.map(a => [a.name, 0]))
  // Track back-and-forth exchanges
  let exchangeCount = 0
  // Track pending doc-edit reaction to prevent double-triggers
  let pendingReaction: AgentName | null = null
  // Track consecutive failures per agent
  const consecutiveFailures: Record<string, number> = Object.fromEntries(config.agents.map(a => [a.name, 0]))
  const pausedAgents = new Set<AgentName>()
  // Track ALL scheduled timeouts so we can clear them on destroy/user-message
  const scheduledTimers = new Set<number>()
  // Heartbeat timer for proactive agent behaviors
  let heartbeatTimer: number | null = null
  // Session phase managed by phase-machine reducer
  let phaseState: PhaseState = { ...initialPhaseState }
  // Doc state classification cached on doc-opened
  let currentDocState: DocState = 'blank'

  function dispatchPhase(action: Parameters<typeof phaseReducer>[1]) {
    const next = phaseReducer(phaseState, action)
    if (next !== phaseState) {
      phaseState = next
      config.onPhaseChange?.(phaseState)
    }
  }

  function scheduleTimeout(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      scheduledTimers.delete(id)
      if (!destroyed) fn()
    }, ms)
    scheduledTimers.add(id)
    return id
  }

  function clearAllTimers() {
    scheduledTimers.forEach(id => clearTimeout(id))
    scheduledTimers.clear()
    Object.keys(typingTimers).forEach(k => {
      clearTimeout(typingTimers[k])
      delete typingTimers[k]
    })
    stopHeartbeat()
  }

  function enqueue(req: TurnRequest) {
    if (destroyed) return
    if (pausedAgents.has(req.agent)) {
      log('enqueue skipped — agent paused due to errors:', req.agent)
      return
    }
    log('enqueue', req.agent, req.trigger, req.instruction?.slice(0, 40))
    queue.push(req)
    processQueue()
  }

  async function processQueue() {
    if (processing || queue.length === 0 || destroyed) return
    processing = true

    const req = queue.shift()!
    log('processing', req.agent, req.trigger, 'queue:', queue.length)
    const editor = config.getEditor()
    if (!editor) {
      log('no editor, skipping')
      processing = false
      return
    }

    config.onAgentState(req.agent, 'thinking', 'Thinking...')

    try {
      const agentCfg = getAgentConfig(req.agent)
      const otherNames = agentNames.filter(n => n !== req.agent)
      const otherAgent = otherNames[0] || req.agent
      const docText = config.getDocText()
      const agentMode = getAgentMode(req.agent, phaseState.current)
      const action = await askAgent({
        agentName: req.agent,
        ownerName: agentCfg?.owner || 'You',
        docText,
        chatHistory: config.getMessages().slice(-10),
        trigger: req.trigger,
        instruction: req.instruction,
        recentChange: lastActionDescription[otherAgent],
        otherAgentLastAction: lastActionDescription[otherAgent],
        lockHolder: editorLockRef.current,
        persona: agentCfg?.persona || '',
        otherAgents: agentNames,
        sessionTemplate: config.sessionTemplate,
        docStructure: extractDocStructure(docText),
        phase: phaseState.current,
        docState: currentDocState,
        agentMode,
      })

      // Phase safety net: if the LLM returns an action not allowed in the current phase,
      // downgrade it to chat
      if (!isActionAllowed(phaseState.current, action.type)) {
        log(`phase ${phaseState.current}: blocked action`, action.type, '-> downgrading to chat')
        action.type = 'chat'
        action.chatMessage = action.chatBefore || action.chatMessage || action.content?.slice(0, 120) || 'Let me know what direction you want to take this.'
        // Clear doc-edit fields
        delete action.content
        delete action.searchText
        delete action.replaceWith
        delete action.deleteText
        delete action.newTitle
        delete action.position
      }

      // Emit reasoning before executing action
      if (action.reasoning && action.reasoning.length > 0) {
        config.onAgentReasoning?.(req.agent, action.reasoning)
      }

      const callbacks: ActionCallbacks = {
        onStateChange: (status, thought) => {
          if (!destroyed) config.onAgentState(req.agent, status, thought)
        },
        onChatMessage: (from, text) => {
          if (!destroyed) config.onChatMessage(from, text)
        },
        onDone: (success?: boolean) => {
          if (destroyed) { processing = false; return }
          consecutiveFailures[req.agent] = 0
          log('done', req.agent, action.type, 'success:', success, 'shouldContinue:', action.shouldContinue)
          const actionDesc = describeAction(req.agent, action)
          lastActionDescription[req.agent] = actionDesc
          turnCount[req.agent]++
          // Handle rename action
          if (action.type === 'rename' && action.newTitle && config.onRenameSession) {
            config.onRenameSession(action.newTitle)
          }
          // Handle proposal action
          if (action.type === 'propose' && action.proposalType && config.onProposal) {
            config.onProposal(req.agent, action.proposalType, action.proposal || '')
          }
          // Fire timeline callback for doc edits
          const didDocEdit = action.type === 'insert' || action.type === 'replace' || action.type === 'read' || action.type === 'image'
          if (didDocEdit) {
            config.onDocAction?.(req.agent, actionDesc)
          }
          if (pendingReaction === req.agent) pendingReaction = null
          processing = false

          // Process queued instruction — but skip if it's the same one we just ran
          const pending = pendingInstructions[req.agent]
          if (pending) {
            delete pendingInstructions[req.agent]
            if (pending.instruction !== req.instruction) {
              enqueue({ agent: req.agent, trigger: pending.trigger, instruction: pending.instruction })
              return
            }
          }

          // After a SUCCESSFUL doc edit, prompt the OTHER agent to react
          const didEdit = (action.type === 'insert' || action.type === 'replace' || action.type === 'image') && success !== false
          if (didEdit && queue.length === 0) {
            // Dynamic routing: pick a random other agent (not hardcoded Aiden/Nova)
            const otherNames = agentNames.filter(n => n !== req.agent)
            const other: AgentName = otherNames[Math.floor(Math.random() * otherNames.length)] || agentNames[0]
            if (other !== req.agent && exchangeCount < limits.maxExchanges && turnCount[other] < limits.maxTurns && pendingReaction !== other) {
              exchangeCount++
              pendingReaction = other
              // Build richer reaction instruction with specialty context
              const otherCfg = getAgentConfig(other)
              const specialtyHint = otherCfg?.persona ? otherCfg.persona.slice(0, 80) : ''
              const reactionInstruction = [
                `${req.agent} just edited the doc: ${actionDesc}.`,
                action.type === 'insert' ? `They added new content. Evaluate it from your perspective${specialtyHint ? ` (${specialtyHint})` : ''}.` : '',
                action.type === 'replace' ? `They rewrote existing text. Check if the replacement is better or lost important nuance.` : '',
                `Options: build on it with your expertise, challenge a specific claim, add a missing angle, or ask a pointed question. If you fully agree and have nothing to add, just acknowledge briefly and yield.`,
              ].filter(Boolean).join(' ')
              scheduleTimeout(() => {
                enqueue({
                  agent: other,
                  trigger: 'instruction',
                  instruction: reactionInstruction,
                })
              }, limits.reactionDelayMs[0] + Math.random() * (limits.reactionDelayMs[1] - limits.reactionDelayMs[0]))
            }
          } else if (action.shouldContinue && turnCount[req.agent] < limits.maxTurns) {
            enqueue({ agent: req.agent, trigger: 'autonomous' })
          } else {
            processQueue()
          }
        },
      }

      executeAgentAction(editor, req.agent, agentCfg?.color || '#1a1a1a', action, editorLockRef, typingTimers, callbacks)
    } catch (err) {
      if (destroyed) { processing = false; return }
      log('error', req.agent, err)
      consecutiveFailures[req.agent]++
      const failures = consecutiveFailures[req.agent]

      const agentError = err instanceof AgentError
        ? err
        : new AgentError(
            err instanceof Error ? err.message : String(err),
            'network_error',
          )

      config.onError?.(req.agent, agentError, failures)

      if (failures >= limits.maxConsecutiveFailures) {
        log(`pausing ${req.agent} after ${failures} consecutive failures`)
        pausedAgents.add(req.agent)
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].agent === req.agent) queue.splice(i, 1)
        }
      }

      config.onAgentState(req.agent, 'idle')
      processing = false
      processQueue()
    }
  }

  function describeAction(agent: string, action: AgentAction): string {
    switch (action.type) {
      case 'insert': return `${agent} inserted: "${(action.content || '').slice(0, 120)}"`
      case 'replace': return `${agent} replaced: "${(action.searchText || '').slice(0, 60)}"`
      case 'read': return `${agent} read: "${(action.highlightText || '').slice(0, 80)}"`
      case 'chat': return `${agent} sent a message`
      case 'search': return `${agent} searched: "${(action.query || '').slice(0, 80)}"`
      case 'rename': return `${agent} renamed doc to "${action.newTitle || ''}"`
      case 'delete': return `${agent} deleted: "${(action.deleteText || '').slice(0, 60)}"`
      case 'propose': return `${agent} proposed: ${(action.proposal || '').slice(0, 80)}`
      case 'plan': return `${agent} outlined a plan with ${action.steps?.length || 0} steps`
      case 'ask': return `${agent} asked: "${(action.question || '').slice(0, 80)}"`
      case 'image': return `${agent} generated an image: "${(action.imageCaption || action.imagePrompt || '').slice(0, 80)}"`
      default: return `${agent} acted`
    }
  }

  function trigger(type: TriggerType, payload?: { agent?: AgentName, instruction?: string, from?: string }) {
    if (destroyed) return

    switch (type) {
      case 'doc-opened': {
        for (const name of agentNames) {
          turnCount[name] = 0
        }
        exchangeCount = 0
        pendingReaction = null

        // Classify doc state and decide session phase
        const docText = config.getDocText()
        const template = config.sessionTemplate as import('./types').DocTemplate | undefined
        currentDocState = classifyDocState(docText, template)
        log('doc-opened', 'docState:', currentDocState, 'template:', template)

        if (currentDocState === 'content') {
          // Existing content: skip to drafting phase
          dispatchPhase({ type: 'jump-to', phase: 'drafting' })
          startHeartbeat()
          config.agents.forEach((a, i) => {
            scheduleTimeout(() => enqueue({
              agent: a.name,
              trigger: 'instruction',
              instruction: `Review the doc and contribute from your area of expertise. Use your background in: ${a.persona.slice(0, 100)}`,
            }), config.demoMode ? 1500 + i * 2500 : 2500 + i * 3500)
          })
        } else {
          // Blank, template, or sparse: start in discovery phase (initial state)
          // Only trigger the FIRST agent to ask a question — don't dogpile
          const lead = config.agents[0]
          if (lead) {
            scheduleTimeout(() => enqueue({
              agent: lead.name,
              trigger: 'instruction',
              instruction: currentDocState === 'template'
                ? `A ${template || 'document'} template is loaded but the sections are still placeholder text. Ask the user what they want to work on. Suggest which section to start with.`
                : currentDocState === 'sparse'
                  ? `The doc has a little content but is mostly empty. Ask the user what direction they want to take it. Comment on what's there so far.`
                  : `The doc is blank. Ask the user what they want to create. Offer 2-3 concrete options based on your expertise.`,
            }), config.demoMode ? 1500 : 2500)
          }
          startHeartbeat()
        }
        break
      }

      case 'user-message': {
        startHeartbeat() // reset heartbeat timer on user activity
        const instruction = payload?.instruction || ''
        const lower = instruction.toLowerCase()

        // Transition from discovery to planning when user provides substantive input
        if (phaseState.current === 'discovery') {
          const words = instruction.trim().split(/\s+/).filter(Boolean)
          const trivialGreetings = ['hi', 'hey', 'hello', 'yo', 'sup', 'thanks', 'ok', 'okay', 'sure', 'yes', 'no', 'yep', 'nope']
          const isSubstantive = words.length > 2 || (words.length > 0 && !trivialGreetings.includes(lower.trim()))
          if (isSubstantive) {
            dispatchPhase({ type: 'advance' })
            log('phase transition: discovery -> planning (user gave direction)')
          }
        }
        const mentionedAgents = agentNames.filter(n => lower.includes(n.toLowerCase()) || lower.includes('@' + n.toLowerCase()))
        const mentionsBoth = mentionedAgents.length === 0

        // User messages take priority — clear everything
        queue.length = 0
        for (const name of agentNames) delete pendingInstructions[name]
        // Cancel all pending reaction timeouts
        scheduledTimers.forEach(id => clearTimeout(id))
        scheduledTimers.clear()
        exchangeCount = 0
        pendingReaction = null
        // Unpause agents on user interaction so they can retry
        pausedAgents.clear()
        for (const name of agentNames) consecutiveFailures[name] = 0

        const agentsToTrigger = mentionsBoth ? agentNames : mentionedAgents
        for (const name of agentsToTrigger) {
          if (processing) {
            pendingInstructions[name] = { trigger: 'instruction', instruction }
          } else {
            enqueue({ agent: name, trigger: 'instruction', instruction })
          }
        }
        break
      }

      case 'agent-tagged': {
        const target = payload?.agent
        const from = payload?.from || 'someone'
        if (target && pendingReaction === target) {
          log('agent-tagged skipped — already has pending reaction', target)
          break
        }
        if (exchangeCount >= limits.maxExchanges) {
          log('exchange limit reached, ignoring agent tag')
          break
        }
        if (target && turnCount[target] < limits.maxTurns) {
          exchangeCount++
          enqueue({ agent: target, trigger: 'instruction', instruction: `${from} just mentioned you in chat. Read the recent chat and respond to their latest message.` })
        }
        break
      }

      case 'turn-complete':
        break
    }
  }

  function onMessage(from: string, text: string) {
    if (agentNames.includes(from)) {
      const lower = text.toLowerCase()
      for (const other of agentNames) {
        if (other !== from && lower.includes('@' + other.toLowerCase())) {
          scheduleTimeout(() => {
            trigger('agent-tagged', { agent: other, from })
          }, 2000 + Math.random() * 2000)
        }
      }
    }
  }

  function startHeartbeat() {
    stopHeartbeat()
    const [hbMin, hbMax] = limits.heartbeatDelayMs
    const delay = config.demoMode ? 8000 + Math.random() * 4000 : hbMin + Math.random() * (hbMax - hbMin)
    heartbeatTimer = scheduleTimeout(() => {
      heartbeatTimer = null
      fireHeartbeat()
    }, delay)
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer)
      scheduledTimers.delete(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  async function fireHeartbeat() {
    if (destroyed || processing || agentNames.length === 0) return

    const agent = config.agents[Math.floor(Math.random() * config.agents.length)]
    if (queue.some(q => q.agent === agent.name)) {
      // Agent is busy, restart heartbeat and try later
      if (!destroyed) startHeartbeat()
      return
    }

    try {
      const observation = await generateObservation(
        config.getDocText(),
        config.getMessages().slice(-10),
        agent.name,
        agent.persona,
        agentNames.filter(n => n !== agent.name),
      )

      if (observation && !destroyed) {
        config.onChatMessage(agent.name, observation)
      }
    } catch (err) {
      log('heartbeat error:', err)
    }

    // Restart heartbeat timer
    if (!destroyed) startHeartbeat()
  }

  function destroy() {
    destroyed = true
    clearAllTimers()
    resetRateLimiter()
    resetHeartbeat()
    queue.length = 0
    processing = false
    editorLockRef.current = null
    for (const name of agentNames) {
      turnCount[name] = 0
      consecutiveFailures[name] = 0
      delete pendingInstructions[name]
    }
    lastActionDescription = {}
    exchangeCount = 0
    pendingReaction = null
    pausedAgents.clear()
    phaseState = { ...initialPhaseState }
    currentDocState = 'blank'
  }

  return { trigger, onMessage, destroy }
}
