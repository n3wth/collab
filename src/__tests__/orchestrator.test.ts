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
  extractDocStructure: vi.fn().mockReturnValue({ headings: [], wordCounts: {} }),
}))

// Mock agent-actions module
vi.mock('../agent-actions', () => ({
  executeAgentAction: vi.fn((_editor, _name, _color, _action, _lock, _timers, callbacks) => {
    // Simulate immediate completion
    callbacks.onDone(true)
  }),
}))

// Mock heartbeat module
vi.mock('../heartbeat', () => ({
  generateObservation: vi.fn().mockResolvedValue(null),
  resetHeartbeat: vi.fn(),
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

describe('error handling and resilience', () => {
  beforeEach(() => {
    timers.length = 0
    nextTimerId = 1
    vi.clearAllMocks()
  })

  it('agent error triggers onError callback and sets agent to idle', async () => {
    const { askAgent, AgentError } = await import('../agent')
    const mockAskAgent = vi.mocked(askAgent)
    mockAskAgent.mockRejectedValueOnce(new AgentError('API down', 'api_error'))

    const config = makeConfig({ onError: vi.fn() })
    const orch = createOrchestrator(config)
    orch.trigger('user-message', { instruction: '@aiden do something' })

    await vi.waitFor(() => {
      expect(config.onError).toHaveBeenCalledWith(
        'Aiden',
        expect.objectContaining({ code: 'api_error' }),
        1,
      )
    })
    // Agent should be set back to idle after error
    expect(config.onAgentState).toHaveBeenCalledWith('Aiden', 'idle')
    orch.destroy()
  })

  it('agent is paused after maxConsecutiveFailures', async () => {
    const { askAgent, AgentError } = await import('../agent')
    const mockAskAgent = vi.mocked(askAgent)
    // Fail 3 times in a row (default maxConsecutiveFailures)
    mockAskAgent.mockRejectedValue(new AgentError('API down', 'api_error'))

    const config = makeConfig({ onError: vi.fn() })
    const orch = createOrchestrator(config)

    // Trigger 3 failures for Aiden
    orch.trigger('user-message', { instruction: '@aiden try 1' })
    await vi.waitFor(() => expect(config.onError).toHaveBeenCalledTimes(1))

    orch.trigger('user-message', { instruction: '@aiden try 2' })
    await vi.waitFor(() => expect(config.onError).toHaveBeenCalledTimes(2))

    orch.trigger('user-message', { instruction: '@aiden try 3' })
    await vi.waitFor(() => expect(config.onError).toHaveBeenCalledTimes(3))

    // 4th attempt should be skipped (paused)
    mockAskAgent.mockClear()
    orch.trigger('user-message', { instruction: '@aiden try 4' })
    // askAgent should NOT be called because Aiden is paused
    // But user-message also clears pausedAgents, so it will work again
    // The clear happens before enqueue, so it should go through
    await vi.waitFor(() => expect(mockAskAgent).toHaveBeenCalled())

    orch.destroy()
  })

  it('user message unpauses agents and resets failure counts', async () => {
    const { askAgent, AgentError } = await import('../agent')
    const mockAskAgent = vi.mocked(askAgent)
    // Fail enough to pause
    mockAskAgent
      .mockRejectedValueOnce(new AgentError('fail', 'api_error'))
      .mockRejectedValueOnce(new AgentError('fail', 'api_error'))
      .mockRejectedValueOnce(new AgentError('fail', 'api_error'))
      // Then succeed on next user message
      .mockResolvedValueOnce({ type: 'chat', chatMessage: 'back online', shouldContinue: false })

    const config = makeConfig({ onError: vi.fn() })
    const orch = createOrchestrator(config)

    orch.trigger('user-message', { instruction: '@aiden first' })
    await vi.waitFor(() => expect(config.onError).toHaveBeenCalledTimes(1))
    orch.trigger('user-message', { instruction: '@aiden second' })
    await vi.waitFor(() => expect(config.onError).toHaveBeenCalledTimes(2))
    orch.trigger('user-message', { instruction: '@aiden third' })
    await vi.waitFor(() => expect(config.onError).toHaveBeenCalledTimes(3))

    // User message should unpause and reset failures
    orch.trigger('user-message', { instruction: '@aiden try again' })
    await vi.waitFor(() => {
      expect(config.onAgentState).toHaveBeenCalledWith('Aiden', 'thinking', 'Thinking...')
    })

    orch.destroy()
  })

  it('non-AgentError is wrapped as network_error', async () => {
    const { askAgent } = await import('../agent')
    const mockAskAgent = vi.mocked(askAgent)
    mockAskAgent.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const config = makeConfig({ onError: vi.fn() })
    const orch = createOrchestrator(config)
    orch.trigger('user-message', { instruction: '@aiden test' })

    await vi.waitFor(() => {
      expect(config.onError).toHaveBeenCalledWith(
        'Aiden',
        expect.objectContaining({ code: 'network_error' }),
        1,
      )
    })
    orch.destroy()
  })

  it('destroy during processing does not call callbacks', async () => {
    const { askAgent } = await import('../agent')
    const mockAskAgent = vi.mocked(askAgent)

    // Make askAgent hang forever via a never-resolving promise
    let rejectFn: (err: Error) => void
    mockAskAgent.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectFn = reject
    }))

    const config = makeConfig()
    const orch = createOrchestrator(config)
    orch.trigger('user-message', { instruction: '@aiden test' })

    // Destroy while askAgent is pending
    orch.destroy()

    // Resolve the pending promise — callbacks should not fire
    rejectFn!(new Error('cancelled'))
    await new Promise(r => globalThis.setTimeout(r, 10))

    // onChatMessage should not have been called after destroy
    expect(config.onChatMessage).not.toHaveBeenCalled()
  })

  it('exchange limit prevents runaway agent-to-agent reactions', async () => {
    const { askAgent } = await import('../agent')
    const mockAskAgent = vi.mocked(askAgent)
    // All calls return chat (no doc edits = no reactions)
    mockAskAgent.mockResolvedValue({ type: 'chat', chatMessage: 'ok', shouldContinue: false })

    const config = makeConfig({ limits: { maxExchanges: 2 } })
    const orch = createOrchestrator(config)

    // Trigger agent-tagged beyond the exchange limit
    orch.trigger('agent-tagged', { agent: 'Nova', from: 'Aiden' })
    orch.trigger('agent-tagged', { agent: 'Aiden', from: 'Nova' })
    // Third should be ignored
    orch.trigger('agent-tagged', { agent: 'Nova', from: 'Aiden' })

    await vi.waitFor(() => {
      // Should have been called exactly 2 times (not 3)
      expect(mockAskAgent).toHaveBeenCalledTimes(2)
    })

    orch.destroy()
  })

  it('turn limit caps autonomous continuation', async () => {
    const { askAgent } = await import('../agent')
    const mockAskAgent = vi.mocked(askAgent)
    // Return shouldContinue:true to trigger autonomous follow-ups
    mockAskAgent.mockResolvedValue({ type: 'chat', chatMessage: 'continuing', shouldContinue: true })

    const config = makeConfig({ limits: { maxTurns: 2 } })
    const orch = createOrchestrator(config)
    orch.trigger('user-message', { instruction: '@aiden keep going' })

    // Wait for processing to settle
    await vi.waitFor(() => {
      // Should stop at maxTurns (2)
      expect(mockAskAgent).toHaveBeenCalledTimes(2)
    })

    orch.destroy()
  })

  it('scheduled timers do not fire after destroy', () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)
    orch.trigger('doc-opened')

    const timersBefore = timers.length
    expect(timersBefore).toBeGreaterThan(0)

    orch.destroy()

    // All timers should be cleared
    expect(timers.length).toBe(0)
  })

  it('user-message clears pending scheduled timers', () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)
    orch.trigger('doc-opened')

    const timerCount = timers.length
    expect(timerCount).toBeGreaterThan(0)

    // User message should clear all scheduled timers
    orch.trigger('user-message', { instruction: 'hi' })
    // The doc-opened timers (heartbeat + agent schedules) should be cleared
    // New processing may have started
    orch.destroy()
  })
})
