import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock AgentConfigurator before importing agent
vi.mock('../AgentConfigurator', () => ({
  getStoredApiKey: vi.fn(() => null),
}))

// Mock window.location for session ID extraction
vi.stubGlobal('window', {
  location: { pathname: '/s/test-session-123' },
})

import { askAgent, AgentError, resetRateLimiter, type AskParams } from '../agent'

function makeParams(overrides?: Partial<AskParams>): AskParams {
  return {
    agentName: 'Aiden',
    ownerName: 'Oliver',
    docText: 'Test document',
    chatHistory: [],
    trigger: 'instruction',
    instruction: 'add more detail',
    persona: 'Test persona',
    otherAgents: ['Nova'],
    ...overrides,
  }
}

describe('askAgent API integration', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    resetRateLimiter()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends prompt to /api/gemini and returns typed action', async () => {
    const mockAction = {
      type: 'chat',
      reasoning: ['saw question', 'answering'],
      chatMessage: 'Here is some detail.',
      shouldContinue: false,
    }

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ action: mockAction, usage: { input: 100, output: 50 } }),
    })

    const result = await askAgent(makeParams())

    expect(result.type).toBe('chat')
    expect(result.chatMessage).toBe('Here is some detail.')
    expect(fetchSpy).toHaveBeenCalledWith('/api/gemini', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"prompt"'),
    }))
  })

  it('sends prompt as string, not raw Gemini body format', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        action: { type: 'chat', chatMessage: 'ok' },
        usage: { input: 0, output: 0 },
      }),
    })

    await askAgent(makeParams())

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    // New format: { prompt: "..." }
    expect(body).toHaveProperty('prompt')
    expect(typeof body.prompt).toBe('string')
    // Old format had { contents: [...] } — should NOT be present
    expect(body).not.toHaveProperty('contents')
    expect(body).not.toHaveProperty('generationConfig')
  })

  it('includes session ID and agent name in headers', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        action: { type: 'chat', chatMessage: 'ok' },
        usage: { input: 0, output: 0 },
      }),
    })

    await askAgent(makeParams())

    const headers = fetchSpy.mock.calls[0][1].headers
    expect(headers['X-Session-Id']).toBe('test-session-123')
    expect(headers['X-Agent-Name']).toBe('Aiden')
  })

  it('throws AgentError with rate_limit code on 429', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Rate limit exceeded' }),
    })

    try {
      await askAgent(makeParams())
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AgentError)
      expect((e as AgentError).code).toBe('rate_limit')
      expect((e as AgentError).status).toBe(429)
    }
  })

  it('throws AgentError with api_error code on server error', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Proxy request failed', code: 'PROXY_ERROR' }),
    })

    try {
      await askAgent(makeParams())
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AgentError)
      expect((e as AgentError).code).toBe('api_error')
    }
  })

  it('throws AgentError on empty action response', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ action: null, usage: { input: 0, output: 0 } }),
    })

    try {
      await askAgent(makeParams())
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AgentError)
      expect((e as AgentError).code).toBe('parse_error')
    }
  })

  it('throws AgentError with network_error on fetch failure', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    try {
      await askAgent(makeParams())
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AgentError)
      expect((e as AgentError).code).toBe('network_error')
    }
  })

  it('trims thought to 4 words', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        action: {
          type: 'insert',
          content: 'text',
          position: 'end',
          thought: 'This is a very long thought that should be trimmed',
        },
        usage: { input: 0, output: 0 },
      }),
    })

    const result = await askAgent(makeParams())
    expect(result.thought).toBe('This is a very')
  })

  it('trims reasoning to 3 entries of max 60 chars', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        action: {
          type: 'chat',
          chatMessage: 'ok',
          reasoning: [
            'step 1',
            'step 2',
            'step 3',
            'step 4 should be removed',
          ],
        },
        usage: { input: 0, output: 0 },
      }),
    })

    const result = await askAgent(makeParams())
    expect(result.reasoning).toHaveLength(3)
    expect(result.reasoning).toEqual(['step 1', 'step 2', 'step 3'])
  })
})
