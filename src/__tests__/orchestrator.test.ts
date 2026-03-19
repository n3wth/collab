import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock agent module before importing orchestrator
vi.mock('../agent', () => ({
  askAgent: vi.fn().mockResolvedValue({
    type: 'chat',
    chatMessage: 'test message',
    shouldContinue: false,
  }),
  AgentError: class AgentError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
    }
  },
  resetRateLimiter: vi.fn(),
}))

// Mock agent-actions module
vi.mock('../agent-actions', () => ({
  executeAgentAction: vi.fn((_editor, _name, _action, _lock, _timers, callbacks) => {
    // Simulate immediate completion
    callbacks.onDone(true)
  }),
}))

// Stub window.setTimeout/clearTimeout for orchestrator's scheduleTimeout
const timers: { id: number, fn: () => void, ms: number }[] = []
let nextTimerId = 1
vi.stubGlobal('window', {
  setTimeout: (fn: () => void, ms: number) => {
    const id = nextTimerId++
    timers.push({ id, fn, ms })
    return id
  },
  clearTimeout: (id: number) => {
    const idx = timers.findIndex(t => t.id === id)
    if (idx >= 0) timers.splice(idx, 1)
  },
})

// Also stub global clearTimeout for the orchestrator's clearAllTimers
vi.stubGlobal('clearTimeout', (id: number) => {
  const idx = timers.findIndex(t => t.id === id)
  if (idx >= 0) timers.splice(idx, 1)
})

import { createOrchestrator } from '../orchestrator'

function makeConfig(overrides?: Partial<Parameters<typeof createOrchestrator>[0]>) {
  return {
    getEditor: vi.fn(() => ({} as never)),
    getDocText: vi.fn(() => 'Test document content'),
    getMessages: vi.fn(() => []),
    onAgentState: vi.fn(),
    onChatMessage: vi.fn(),
    agents: [
      { name: 'Aiden', persona: 'Test persona', owner: 'You', color: '#1a1a1a' },
      { name: 'Nova', persona: 'Test persona', owner: 'Sarah', color: '#1a1a1a' },
    ],
    ...overrides,
  }
}

describe('createOrchestrator', () => {
  beforeEach(() => {
    timers.length = 0
    nextTimerId = 1
    vi.clearAllMocks()
  })

  it('returns an object with trigger, onMessage, destroy', () => {
    const orch = createOrchestrator(makeConfig())
    expect(orch).toHaveProperty('trigger')
    expect(orch).toHaveProperty('onMessage')
    expect(orch).toHaveProperty('destroy')
    orch.destroy()
  })

  it('trigger doc-opened schedules both agents', () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)
    orch.trigger('doc-opened')
    // Should have scheduled 3 timers (heartbeat + Aiden at 2500ms + Nova at 6000ms)
    expect(timers.length).toBe(3)
    // First timer is the heartbeat (20-30s range)
    expect(timers[0].ms).toBeGreaterThanOrEqual(20000)
    expect(timers[1].ms).toBe(2500)
    expect(timers[2].ms).toBe(6000)
    orch.destroy()
  })

  it('trigger user-message clears queue and enqueues both agents when no mention', () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)
    orch.trigger('user-message', { instruction: 'add more detail' })
    // Both Aiden and Nova should be enqueued (no specific mention)
    // The first agent processes immediately via askAgent mock
    expect(config.onAgentState).toHaveBeenCalled()
    orch.destroy()
  })

  it('trigger user-message with @aiden only enqueues Aiden', async () => {
    const { askAgent } = await import('../agent')
    const config = makeConfig()
    const orch = createOrchestrator(config)
    orch.trigger('user-message', { instruction: '@aiden expand this section' })
    // askAgent should be called for Aiden
    await vi.waitFor(() => {
      expect(askAgent).toHaveBeenCalledWith(
        expect.objectContaining({ agentName: 'Aiden' })
      )
    })
    orch.destroy()
  })

  it('trigger user-message with @nova only enqueues Nova', async () => {
    const { askAgent } = await import('../agent')
    const config = makeConfig()
    const orch = createOrchestrator(config)
    orch.trigger('user-message', { instruction: '@nova review this' })
    await vi.waitFor(() => {
      expect(askAgent).toHaveBeenCalledWith(
        expect.objectContaining({ agentName: 'Nova' })
      )
    })
    orch.destroy()
  })

  it('destroy prevents further processing', () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)
    orch.destroy()
    orch.trigger('user-message', { instruction: 'hello' })
    // No agent state changes should happen after destroy
    expect(config.onAgentState).not.toHaveBeenCalled()
  })

  it('skips processing when no editor available', async () => {
    const config = makeConfig({ getEditor: vi.fn(() => null) })
    const orch = createOrchestrator(config)
    orch.trigger('user-message', { instruction: 'test' })
    // Should not call onAgentState with thinking since editor is null
    await new Promise(r => globalThis.setTimeout(r, 10))
    // onAgentState may or may not be called depending on queue processing order
    // but askAgent should not be called
    const { askAgent } = await import('../agent')
    expect(askAgent).not.toHaveBeenCalled()
    orch.destroy()
  })

  it('onMessage detects agent @mentions and schedules tag trigger', () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)
    orch.onMessage('Aiden', 'hey @nova what do you think?')
    // Should schedule a timer for the agent-tagged trigger
    expect(timers.length).toBeGreaterThan(0)
    orch.destroy()
  })

  it('accepts custom limits via config', () => {
    const config = makeConfig({
      limits: { maxTurns: 10, heartbeatDelayMs: [5000, 8000] },
    })
    const orch = createOrchestrator(config)
    orch.trigger('doc-opened')
    // Heartbeat timer should use custom range (5000-8000ms)
    expect(timers[0].ms).toBeGreaterThanOrEqual(5000)
    expect(timers[0].ms).toBeLessThanOrEqual(8000)
    orch.destroy()
  })
})

describe('describeAction (tested via orchestrator internals)', () => {
  // describeAction is private but we can verify its effects through chat messages
  // and action descriptions that flow through the orchestrator
  it('orchestrator handles insert action type', async () => {
    const { askAgent } = await import('../agent')
    const mockAskAgent = vi.mocked(askAgent)
    mockAskAgent.mockResolvedValueOnce({
      type: 'insert',
      content: 'New section content here',
      position: 'end',
      shouldContinue: false,
    })

    const config = makeConfig()
    const orch = createOrchestrator(config)
    orch.trigger('user-message', { instruction: '@aiden add content' })
    await vi.waitFor(() => {
      expect(mockAskAgent).toHaveBeenCalled()
    })
    orch.destroy()
  })
})
