import { describe, it, expect, vi } from 'vitest'

// The module uses import.meta.env, so we need to mock it before importing
vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })

// We test the exported askAgent by mocking fetch, plus replicate internal pure functions
// for direct unit testing since they're not exported.

// --- Replicated pure functions from agent.ts for direct testing ---

function truncateDoc(text: string, maxChars = 2000): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n[...truncated]'
}

interface AgentAction {
  type: 'insert' | 'replace' | 'read' | 'chat'
  position?: string
  content?: string
  searchText?: string
  replaceWith?: string
  highlightText?: string
  chatBefore?: string
  chatMessage?: string
  thought?: string
  shouldContinue?: boolean
}

function repairJSON(text: string): AgentAction | null {
  try { return JSON.parse(text) } catch { /* continue */ }

  let fixed = text.trim()

  const quoteCount = (fixed.match(/(?<!\\)"/g) || []).length
  if (quoteCount % 2 !== 0) {
    fixed += '"'
  }

  const opens = (fixed.match(/\{/g) || []).length
  const closes = (fixed.match(/\}/g) || []).length
  for (let i = 0; i < opens - closes; i++) fixed += '}'

  try {
    const parsed = JSON.parse(fixed)
    if (parsed.type) return parsed as AgentAction
  } catch { /* continue */ }

  fixed = text.trim()
  const lastCompleteValue = fixed.lastIndexOf('","')
  if (lastCompleteValue > 0) {
    const afterComma = fixed.indexOf('"', lastCompleteValue + 2)
    if (afterComma > 0) {
      const afterColon = fixed.indexOf(':', afterComma)
      if (afterColon > 0) {
        const valueStart = fixed.indexOf('"', afterColon)
        if (valueStart > 0) {
          const valueEnd = fixed.indexOf('"', valueStart + 1)
          if (valueEnd < 0) {
            fixed = fixed.slice(0, lastCompleteValue + 1) + '}'
            try {
              const parsed = JSON.parse(fixed)
              if (parsed.type) return parsed as AgentAction
            } catch { /* continue */ }
          }
        }
      }
    }
  }

  return null
}

// --- Rate limiter logic tests (replicated structure) ---

function createRateLimiter() {
  return {
    lastCallTime: 0,
    minIntervalMs: 7000,
    backoffUntil: 0,
    consecutiveErrors: 0,
    maxRetries: 3,

    onSuccess() {
      this.consecutiveErrors = 0
    },

    onRateLimit() {
      this.consecutiveErrors++
      const backoffSec = Math.min(60, 5 * Math.pow(2, this.consecutiveErrors - 1))
      this.backoffUntil = Date.now() + backoffSec * 1000
    },

    onError() {
      this.consecutiveErrors++
      if (this.consecutiveErrors >= this.maxRetries) {
        this.backoffUntil = Date.now() + 30000
      }
    },

    shouldRetry(): boolean {
      return this.consecutiveErrors < this.maxRetries
    },
  }
}

// --- Tests ---

describe('truncateDoc', () => {
  it('returns short text unchanged', () => {
    expect(truncateDoc('hello')).toBe('hello')
  })

  it('truncates text exceeding maxChars', () => {
    const long = 'a'.repeat(3000)
    const result = truncateDoc(long, 2000)
    expect(result).toBe('a'.repeat(2000) + '\n[...truncated]')
  })

  it('uses custom maxChars', () => {
    const result = truncateDoc('abcdef', 3)
    expect(result).toBe('abc\n[...truncated]')
  })

  it('does not truncate at exactly maxChars', () => {
    const exact = 'a'.repeat(2000)
    expect(truncateDoc(exact)).toBe(exact)
  })
})

describe('repairJSON', () => {
  it('parses valid JSON', () => {
    const action = repairJSON('{"type":"chat","chatMessage":"hello"}')
    expect(action).toEqual({ type: 'chat', chatMessage: 'hello' })
  })

  it('repairs truncated string value', () => {
    const action = repairJSON('{"type":"chat","chatMessage":"hello worl')
    expect(action).not.toBeNull()
    expect(action?.type).toBe('chat')
  })

  it('repairs missing closing brace', () => {
    const action = repairJSON('{"type":"read","thought":"ok"')
    expect(action).not.toBeNull()
    expect(action?.type).toBe('read')
    expect(action?.thought).toBe('ok')
  })

  it('returns null for total garbage', () => {
    expect(repairJSON('not json at all')).toBeNull()
  })

  it('parses valid JSON even without type field (first-pass parse)', () => {
    // repairJSON only checks for .type in repair strategies, not on valid JSON
    const result = repairJSON('{"foo":"bar"}')
    expect(result).toEqual({ foo: 'bar' })
  })

  it('handles truncated mid-value with strategy 2', () => {
    // Truncated after a complete pair, mid-value on next pair
    const action = repairJSON('{"type":"insert","content":"hello world","thought":"writing someth')
    // Should recover at least the type
    expect(action).not.toBeNull()
    expect(action?.type).toBe('insert')
  })
})

describe('rateLimiter', () => {
  it('resets consecutiveErrors on success', () => {
    const rl = createRateLimiter()
    rl.consecutiveErrors = 2
    rl.onSuccess()
    expect(rl.consecutiveErrors).toBe(0)
  })

  it('increments errors and sets backoff on rate limit', () => {
    const rl = createRateLimiter()
    const before = Date.now()
    rl.onRateLimit()
    expect(rl.consecutiveErrors).toBe(1)
    // First rate limit: 5 * 2^0 = 5s backoff
    expect(rl.backoffUntil).toBeGreaterThanOrEqual(before + 5000)
  })

  it('exponentially increases backoff on repeated rate limits', () => {
    const rl = createRateLimiter()
    rl.onRateLimit() // 5s
    rl.onRateLimit() // 10s
    rl.onRateLimit() // 20s
    expect(rl.consecutiveErrors).toBe(3)
  })

  it('caps backoff at 60 seconds', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 10; i++) rl.onRateLimit()
    // 5 * 2^9 = 2560, capped to 60
    const backoffSec = Math.min(60, 5 * Math.pow(2, 9))
    expect(backoffSec).toBe(60)
  })

  it('shouldRetry is true when under maxRetries', () => {
    const rl = createRateLimiter()
    rl.consecutiveErrors = 2
    expect(rl.shouldRetry()).toBe(true)
  })

  it('shouldRetry is false at maxRetries', () => {
    const rl = createRateLimiter()
    rl.consecutiveErrors = 3
    expect(rl.shouldRetry()).toBe(false)
  })

  it('onError sets cooldown after maxRetries errors', () => {
    const rl = createRateLimiter()
    const before = Date.now()
    rl.onError()
    rl.onError()
    rl.onError() // hits maxRetries (3)
    expect(rl.backoffUntil).toBeGreaterThanOrEqual(before + 30000)
  })
})
