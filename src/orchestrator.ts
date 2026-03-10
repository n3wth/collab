import type { Editor } from '@tiptap/react'
import { askAgent, AgentError, resetRateLimiter, type AgentAction, type AskParams } from './agent'
import { executeAgentAction, type ActionCallbacks } from './agent-actions'

type AgentName = 'Aiden' | 'Nova'
type TriggerType = 'doc-opened' | 'user-message' | 'agent-tagged' | 'turn-complete'

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
  onError?: (agent: AgentName, error: AgentError, consecutiveFailures: number) => void
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
  // Track total turns per agent (caps all non-user-initiated work)
  const turnCount: Record<string, number> = { Aiden: 0, Nova: 0 }
  const MAX_TURNS = 4
  // Track back-and-forth exchanges
  let exchangeCount = 0
  const MAX_EXCHANGES = 4
  // Track pending doc-edit reaction to prevent double-triggers
  let pendingReaction: AgentName | null = null
  // Track consecutive failures per agent — pause after MAX_CONSECUTIVE_FAILURES
  const consecutiveFailures: Record<string, number> = { Aiden: 0, Nova: 0 }
  const MAX_CONSECUTIVE_FAILURES = 3
  const pausedAgents = new Set<AgentName>()
  // Track ALL scheduled timeouts so we can clear them on destroy/user-message
  const scheduledTimers = new Set<number>()

  function scheduleTimeout(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      scheduledTimers.delete(id)
      fn()
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
      const otherAgent: AgentName = req.agent === 'Aiden' ? 'Nova' : 'Aiden'
      const action = await askAgent({
        agentName: req.agent,
        ownerName: req.agent === 'Aiden' ? 'You' : 'Sarah',
        docText: config.getDocText(),
        chatHistory: config.getMessages().slice(-10),
        trigger: req.trigger,
        instruction: req.instruction,
        recentChange: lastActionDescription[otherAgent],
        otherAgentLastAction: lastActionDescription[otherAgent],
        lockHolder: editorLockRef.current,
      })

      const callbacks: ActionCallbacks = {
        onStateChange: (status, thought) => config.onAgentState(req.agent, status, thought),
        onChatMessage: (from, text) => config.onChatMessage(from, text),
        onDone: (success?: boolean) => {
          if (destroyed) return
          consecutiveFailures[req.agent] = 0
          log('done', req.agent, action.type, 'success:', success, 'shouldContinue:', action.shouldContinue)
          const actionDesc = describeAction(req.agent, action)
          lastActionDescription[req.agent] = actionDesc
          turnCount[req.agent]++
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
          const didEdit = (action.type === 'insert' || action.type === 'replace') && success !== false
          if (didEdit && queue.length === 0) {
            const other: AgentName = req.agent === 'Aiden' ? 'Nova' : 'Aiden'
            if (exchangeCount < MAX_EXCHANGES && turnCount[other] < MAX_TURNS && pendingReaction !== other) {
              exchangeCount++
              pendingReaction = other
              scheduleTimeout(() => {
                if (!destroyed) {
                  enqueue({
                    agent: other,
                    trigger: 'instruction',
                    instruction: `${req.agent} just edited the doc: ${actionDesc}. React to their changes — build on it, challenge it, add your perspective, or ask a question about it. Don't just repeat what they did.`,
                  })
                }
              }, 3000 + Math.random() * 2000)
            }
          } else if (action.shouldContinue && turnCount[req.agent] < MAX_TURNS) {
            enqueue({ agent: req.agent, trigger: 'autonomous' })
          } else {
            processQueue()
          }
        },
      }

      executeAgentAction(editor, req.agent, action, editorLockRef, typingTimers, callbacks)
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

      if (failures >= MAX_CONSECUTIVE_FAILURES) {
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
      case 'insert': return `${agent} inserted content: "${(action.content || '').slice(0, 60)}..."`
      case 'replace': return `${agent} replaced "${(action.searchText || '').slice(0, 30)}" with new text`
      case 'read': return `${agent} was reading "${(action.highlightText || '').slice(0, 40)}"`
      case 'chat': return `${agent} sent a chat message`
      default: return `${agent} took an action`
    }
  }

  function trigger(type: TriggerType, payload?: { agent?: AgentName, instruction?: string, from?: string }) {
    if (destroyed) return

    switch (type) {
      case 'doc-opened':
        turnCount.Aiden = 0
        turnCount.Nova = 0
        exchangeCount = 0
        pendingReaction = null
        scheduleTimeout(() => enqueue({
          agent: 'Aiden',
          trigger: 'instruction',
          instruction: 'Review the doc and add technical depth — architecture details, system design, implementation specifics. Use your engineering expertise.',
        }), 2500)
        scheduleTimeout(() => enqueue({
          agent: 'Nova',
          trigger: 'instruction',
          instruction: 'Review the doc and address the open questions from a product/user perspective — user scenarios, adoption risks, edge cases. Use your product strategy expertise.',
        }), 6000)
        break

      case 'user-message': {
        const instruction = payload?.instruction || ''
        const lower = instruction.toLowerCase()
        const mentionsAiden = lower.includes('aiden') || lower.includes('@aiden')
        const mentionsNova = lower.includes('nova') || lower.includes('@nova')
        const mentionsBoth = !mentionsAiden && !mentionsNova

        // User messages take priority — clear everything
        queue.length = 0
        delete pendingInstructions['Aiden']
        delete pendingInstructions['Nova']
        // Cancel all pending reaction timeouts
        scheduledTimers.forEach(id => clearTimeout(id))
        scheduledTimers.clear()
        exchangeCount = 0
        pendingReaction = null
        // Unpause agents on user interaction so they can retry
        pausedAgents.clear()
        consecutiveFailures.Aiden = 0
        consecutiveFailures.Nova = 0

        if (mentionsAiden || mentionsBoth) {
          if (processing) {
            pendingInstructions['Aiden'] = { trigger: 'instruction', instruction }
          } else {
            enqueue({ agent: 'Aiden', trigger: 'instruction', instruction })
          }
        }
        if (mentionsNova || mentionsBoth) {
          if (processing) {
            pendingInstructions['Nova'] = { trigger: 'instruction', instruction }
          } else {
            enqueue({ agent: 'Nova', trigger: 'instruction', instruction })
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
        if (exchangeCount >= MAX_EXCHANGES) {
          log('exchange limit reached, ignoring agent tag')
          break
        }
        if (target && turnCount[target] < MAX_TURNS) {
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
    if (from === 'Aiden' || from === 'Nova') {
      const other: AgentName = from === 'Aiden' ? 'Nova' : 'Aiden'
      if (text.toLowerCase().includes('@' + other.toLowerCase())) {
        scheduleTimeout(() => {
          trigger('agent-tagged', { agent: other, from })
        }, 2000 + Math.random() * 2000)
      }
    }
  }

  function destroy() {
    destroyed = true
    clearAllTimers()
    resetRateLimiter()
    queue.length = 0
    processing = false
    editorLockRef.current = null
    turnCount.Aiden = 0
    turnCount.Nova = 0
    exchangeCount = 0
    pendingReaction = null
    pausedAgents.clear()
    consecutiveFailures.Aiden = 0
    consecutiveFailures.Nova = 0
  }

  return { trigger, onMessage, destroy }
}
