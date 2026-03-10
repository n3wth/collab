import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The orchestrator uses window.setTimeout and imports from agent.ts (which uses import.meta.env).
// We mock the module dependencies and test the orchestrator's queue/trigger logic.

// Provide a window global that delegates to globalThis (which vitest's fake timers intercept)
vi.stubGlobal('window', {
  setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
  clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
})

// Mock askAgent to return predictable actions
vi.mock('../agent', () => ({
  askAgent: vi.fn().mockResolvedValue({
    type: 'chat',
    chatMessage: 'Mock response',
    shouldContinue: false,
  }),
}))

// Mock agent-actions to call callbacks synchronously
vi.mock('../agent-actions', () => ({
  executeAgentAction: vi.fn((_editor, _agentName, action, _lockRef, _timers, callbacks) => {
    if (action.chatMessage) {
      callbacks.onChatMessage(_agentName, action.chatMessage)
    }
    callbacks.onDone(true)
  }),
}))

// Must import after mocks
import { createOrchestrator } from '../orchestrator'
import { askAgent } from '../agent'
import '../agent-actions' // ensure mock is applied

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    getEditor: () => ({ state: { doc: { content: { size: 100 } } } } as never),
    getDocText: () => 'Test document content',
    getMessages: () => [] as { from: string, text: string }[],
    onAgentState: vi.fn(),
    onChatMessage: vi.fn(),
    ...overrides,
  }
}

describe('createOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns trigger, onMessage, and destroy handles', () => {
    const orch = createOrchestrator(makeConfig())
    expect(typeof orch.trigger).toBe('function')
    expect(typeof orch.onMessage).toBe('function')
    expect(typeof orch.destroy).toBe('function')
    orch.destroy()
  })

  it('trigger doc-opened schedules both agents', async () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)

    orch.trigger('doc-opened')

    // Aiden scheduled at 2500ms
    await vi.advanceTimersByTimeAsync(2500)
    expect(askAgent).toHaveBeenCalledTimes(1)
    expect(vi.mocked(askAgent).mock.calls[0][0].agentName).toBe('Aiden')

    // Nova scheduled at 6000ms
    await vi.advanceTimersByTimeAsync(3500)
    expect(askAgent).toHaveBeenCalledTimes(2)
    expect(vi.mocked(askAgent).mock.calls[1][0].agentName).toBe('Nova')

    orch.destroy()
  })

  it('trigger user-message clears queue and enqueues both agents', async () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)

    orch.trigger('user-message', { instruction: 'Add more detail' })

    // Should enqueue both agents since no specific mention
    await vi.advanceTimersByTimeAsync(100)
    expect(askAgent).toHaveBeenCalled()

    orch.destroy()
  })

  it('user-message mentioning @Aiden only enqueues Aiden', async () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)

    orch.trigger('user-message', { instruction: '@Aiden add a tech spec' })

    await vi.advanceTimersByTimeAsync(100)
    expect(askAgent).toHaveBeenCalledTimes(1)
    expect(vi.mocked(askAgent).mock.calls[0][0].agentName).toBe('Aiden')

    orch.destroy()
  })

  it('user-message mentioning @Nova only enqueues Nova', async () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)

    orch.trigger('user-message', { instruction: '@Nova add user scenarios' })

    await vi.advanceTimersByTimeAsync(100)
    expect(askAgent).toHaveBeenCalledTimes(1)
    expect(vi.mocked(askAgent).mock.calls[0][0].agentName).toBe('Nova')

    orch.destroy()
  })

  it('destroy prevents further processing', async () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)

    orch.destroy()
    orch.trigger('user-message', { instruction: 'do something' })

    await vi.advanceTimersByTimeAsync(5000)
    expect(askAgent).not.toHaveBeenCalled()
  })

  it('skips processing when getEditor returns null', async () => {
    const config = makeConfig({ getEditor: () => null })
    const orch = createOrchestrator(config)

    orch.trigger('user-message', { instruction: 'test' })
    await vi.advanceTimersByTimeAsync(100)

    expect(askAgent).not.toHaveBeenCalled()
    orch.destroy()
  })

  it('onMessage with @mention triggers agent-tagged after delay', async () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)

    orch.onMessage('Aiden', 'Hey @nova what do you think?')

    // agent-tagged fires after 2000-4000ms delay
    await vi.advanceTimersByTimeAsync(4100)
    expect(askAgent).toHaveBeenCalled()
    const call = vi.mocked(askAgent).mock.calls[0]
    expect(call[0].agentName).toBe('Nova')

    orch.destroy()
  })

  it('agent-tagged respects exchange limit', async () => {
    const config = makeConfig()
    const orch = createOrchestrator(config)

    // Trigger doc-opened first to set up state, then advance past scheduled timers
    // Instead, directly trigger agent-tagged many times
    for (let i = 0; i < 6; i++) {
      orch.trigger('agent-tagged', { agent: 'Nova', from: 'Aiden' })
      await vi.advanceTimersByTimeAsync(100)
    }

    // Should be capped at MAX_EXCHANGES (4)
    expect(vi.mocked(askAgent).mock.calls.length).toBeLessThanOrEqual(4)

    orch.destroy()
  })
})
