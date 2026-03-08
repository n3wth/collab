import type { Editor } from '@tiptap/react'
import { askAgent, type AgentAction, type AskParams } from './agent'
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
  // Track how many autonomous turns each agent has taken (cap to avoid runaway API calls)
  const autonomousTurnCount: Record<string, number> = { Aiden: 0, Nova: 0 }
  const MAX_AUTONOMOUS_TURNS = 3 // max turns per agent per doc-opened session
  // Track agent-to-agent tagging to prevent loops
  let agentTagCount = 0
  const MAX_AGENT_TAGS = 2 // max back-and-forth exchanges before cooling off

  function scheduleFollowupTurn(forAgent: AgentName) {
    if (destroyed) return
    if (autonomousTurnCount[forAgent] >= MAX_AUTONOMOUS_TURNS) {
      log(`${forAgent} hit max autonomous turns (${MAX_AUTONOMOUS_TURNS}), stopping`)
      return
    }
    // Stagger the next turn to avoid back-to-back API calls
    const delay = 8000 + Math.random() * 4000
    setTimeout(() => {
      if (!destroyed) {
        enqueue({ agent: forAgent, trigger: 'autonomous' })
      }
    }, delay)
  }

  function enqueue(req: TurnRequest) {
    if (destroyed) return
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
        onDone: () => {
          log('done', req.agent, action.type, 'shouldContinue:', action.shouldContinue)
          lastActionDescription[req.agent] = describeAction(req.agent, action)
          if (req.trigger === 'autonomous') {
            autonomousTurnCount[req.agent]++
          }
          processing = false

          // Process queued instruction (user-triggered always takes priority)
          const pending = pendingInstructions[req.agent]
          if (pending) {
            delete pendingInstructions[req.agent]
            enqueue({ agent: req.agent, trigger: pending.trigger, instruction: pending.instruction })
          }

          // If agent wants another turn and hasn't hit the cap
          if (action.shouldContinue && autonomousTurnCount[req.agent] < MAX_AUTONOMOUS_TURNS) {
            enqueue({ agent: req.agent, trigger: 'autonomous' })
          } else {
            processQueue()
          }
        },
      }

      executeAgentAction(editor, req.agent, action, editorLockRef, typingTimers, callbacks)
    } catch (err) {
      log('error', req.agent, err)
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
        // Reset turn counters for new session
        autonomousTurnCount.Aiden = 0
        autonomousTurnCount.Nova = 0
        // Each agent gets a directed first task matching their expertise
        setTimeout(() => enqueue({
          agent: 'Aiden',
          trigger: 'instruction',
          instruction: 'Review the doc and add technical depth — architecture details, system design, implementation specifics. Use your engineering expertise.',
        }), 2500)
        setTimeout(() => enqueue({
          agent: 'Nova',
          trigger: 'instruction',
          instruction: 'Review the doc and address the open questions from a product/user perspective — user scenarios, adoption risks, edge cases. Use your product strategy expertise.',
        }), 6000)
        // After initial directed work, give each one follow-up autonomous turn
        setTimeout(() => scheduleFollowupTurn('Aiden'), 20000)
        setTimeout(() => scheduleFollowupTurn('Nova'), 25000)
        break

      case 'user-message': {
        const instruction = payload?.instruction || ''
        const lower = instruction.toLowerCase()
        const mentionsAiden = lower.includes('aiden') || lower.includes('@aiden')
        const mentionsNova = lower.includes('nova') || lower.includes('@nova')
        const mentionsBoth = !mentionsAiden && !mentionsNova

        // User messages take priority — clear any queued autonomous/agent-tagged turns
        const urgentOnly = queue.filter(q => q.trigger === 'instruction')
        queue.length = 0
        urgentOnly.forEach(q => queue.push(q))

        // Reset agent tag counter — user is re-engaging
        agentTagCount = 0

        if (mentionsAiden || mentionsBoth) {
          pendingInstructions['Aiden'] = { trigger: 'instruction', instruction }
          if (!processing) {
            const p = pendingInstructions['Aiden']
            delete pendingInstructions['Aiden']
            enqueue({ agent: 'Aiden', trigger: p.trigger, instruction: p.instruction })
          }
        }
        if (mentionsNova || mentionsBoth) {
          pendingInstructions['Nova'] = { trigger: 'instruction', instruction }
          if (!processing) {
            const p = pendingInstructions['Nova']
            delete pendingInstructions['Nova']
            enqueue({ agent: 'Nova', trigger: p.trigger, instruction: p.instruction })
          }
        }
        break
      }

      case 'agent-tagged': {
        // Limit agent-to-agent exchanges to prevent infinite loops
        agentTagCount++
        if (agentTagCount > MAX_AGENT_TAGS) {
          log('agent-to-agent tag limit reached, ignoring')
          break
        }
        const target = payload?.agent
        const from = payload?.from || 'someone'
        if (target) {
          enqueue({ agent: target, trigger: 'instruction', instruction: `${from} just mentioned you in chat. Read the recent chat and respond to their latest message.` })
        }
        break
      }

      case 'turn-complete':
        // Handled internally
        break
    }
  }

  function onMessage(from: string, text: string) {
    // Only trigger on explicit @mentions (not just name in text) to avoid loops
    if (from === 'Aiden' || from === 'Nova') {
      const other: AgentName = from === 'Aiden' ? 'Nova' : 'Aiden'
      if (text.toLowerCase().includes('@' + other.toLowerCase())) {
        setTimeout(() => {
          trigger('agent-tagged', { agent: other, from, instruction: text })
        }, 2000 + Math.random() * 2000)
      }
    }
  }

  function destroy() {
    destroyed = true
    Object.values(typingTimers).forEach(t => clearTimeout(t))
    queue.length = 0
    processing = false
    editorLockRef.current = null
    autonomousTurnCount.Aiden = 0
    autonomousTurnCount.Nova = 0
    agentTagCount = 0
  }

  return { trigger, onMessage, destroy }
}
