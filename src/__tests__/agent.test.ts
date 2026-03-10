import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test the pure functions extracted from agent.ts by re-implementing them here
// since the module uses import.meta.env and fetch which require browser context.

// --- repairJSON (copied from agent.ts for unit testing) ---

interface AgentAction {
  type: 'insert' | 'replace' | 'read' | 'chat'
  position?: 'end' | 'after-heading' | 'cursor' | string
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

// --- truncateDoc (copied from agent.ts) ---

function truncateDoc(text: string, maxChars = 2000): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n[...truncated]'
}

// --- Rate limiter logic (extracted from agent.ts) ---

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

describe('repairJSON', () => {
  it('parses valid JSON directly', () => {
    const input = '{"type":"chat","chatMessage":"hello"}'
    const result = repairJSON(input)
    expect(result).toEqual({ type: 'chat', chatMessage: 'hello' })
  })

  it('repairs truncated string by closing quote and brace', () => {
    const input = '{"type":"chat","chatMessage":"hello world'
    const result = repairJSON(input)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('chat')
  })

  it('repairs missing closing brace', () => {
    const input = '{"type":"read","highlightText":"something"'
    const result = repairJSON(input)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('read')
    expect(result!.highlightText).toBe('something')
  })

  it('returns null for completely invalid input', () => {
    expect(repairJSON('not json at all')).toBeNull()
  })

  it('returns object even without type (valid JSON passthrough)', () => {
    // repairJSON only checks type on the repair path, not valid JSON
    const result = repairJSON('{"content":"foo"}')
    expect(result).toEqual({ content: 'foo' })
  })

  it('handles insert action with all fields', () => {
    const input = JSON.stringify({
      type: 'insert',
      position: 'end',
      content: 'New section',
      thought: 'Adding content',
      chatBefore: 'Working on it',
      shouldContinue: false,
    })
    const result = repairJSON(input)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('insert')
    expect(result!.position).toBe('end')
    expect(result!.content).toBe('New section')
  })

  it('handles replace action', () => {
    const input = JSON.stringify({
      type: 'replace',
      searchText: 'old text',
      replaceWith: 'new text',
      thought: 'Fix',
    })
    const result = repairJSON(input)
    expect(result!.type).toBe('replace')
    expect(result!.searchText).toBe('old text')
    expect(result!.replaceWith).toBe('new text')
  })
})

describe('truncateDoc', () => {
  it('returns short text unchanged', () => {
    expect(truncateDoc('hello', 2000)).toBe('hello')
  })

  it('truncates text exceeding maxChars', () => {
    const longText = 'a'.repeat(3000)
    const result = truncateDoc(longText, 2000)
    expect(result.length).toBeLessThan(3000)
    expect(result).toContain('[...truncated]')
    expect(result.startsWith('a'.repeat(2000))).toBe(true)
  })

  it('uses custom maxChars', () => {
    const text = 'abcdefghij'
    const result = truncateDoc(text, 5)
    expect(result).toBe('abcde\n[...truncated]')
  })
})

describe('rateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('resets consecutiveErrors on success', () => {
    const rl = createRateLimiter()
    rl.consecutiveErrors = 2
    rl.onSuccess()
    expect(rl.consecutiveErrors).toBe(0)
  })

  it('increments consecutiveErrors on rate limit', () => {
    const rl = createRateLimiter()
    rl.onRateLimit()
    expect(rl.consecutiveErrors).toBe(1)
    rl.onRateLimit()
    expect(rl.consecutiveErrors).toBe(2)
  })

  it('computes exponential backoff on rate limit', () => {
    const rl = createRateLimiter()
    const before = Date.now()
    rl.onRateLimit() // first: 5s backoff
    expect(rl.backoffUntil).toBeGreaterThanOrEqual(before + 5000)
    rl.onRateLimit() // second: 10s backoff
    expect(rl.backoffUntil).toBeGreaterThanOrEqual(before + 10000)
  })

  it('caps backoff at 60 seconds', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 10; i++) rl.onRateLimit()
    const backoffSec = Math.min(60, 5 * Math.pow(2, rl.consecutiveErrors - 1))
    expect(backoffSec).toBe(60)
  })

  it('shouldRetry returns false after maxRetries errors', () => {
    const rl = createRateLimiter()
    expect(rl.shouldRetry()).toBe(true)
    rl.onError()
    expect(rl.shouldRetry()).toBe(true)
    rl.onError()
    expect(rl.shouldRetry()).toBe(true)
    rl.onError() // 3rd error
    expect(rl.shouldRetry()).toBe(false)
  })

  it('sets cooldown backoff after too many errors', () => {
    const rl = createRateLimiter()
    const before = Date.now()
    rl.onError()
    rl.onError()
    rl.onError() // triggers 30s cooldown
    expect(rl.backoffUntil).toBeGreaterThanOrEqual(before + 30000)
  })
})
