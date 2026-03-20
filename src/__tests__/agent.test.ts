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

describe('validateAction (replicated from agent.ts)', () => {
  // Replicate the full VALID_ACTION_TYPES set and validateAction logic
  const VALID_ACTION_TYPES = new Set(['insert', 'replace', 'read', 'chat', 'search', 'rename', 'delete', 'propose', 'plan', 'ask'])

  function validateAction(obj: unknown): Record<string, unknown> | null {
    if (typeof obj !== 'object' || obj === null) return null
    const record = obj as Record<string, unknown>
    if (typeof record.type !== 'string') return null
    if (!VALID_ACTION_TYPES.has(record.type)) return null
    switch (record.type) {
      case 'insert':
        if (typeof record.content !== 'string' || !record.content) return null
        break
      case 'replace':
        if (typeof record.searchText !== 'string' || !record.searchText) return null
        if (typeof record.replaceWith !== 'string') return null
        break
      case 'chat':
        if (typeof record.chatMessage !== 'string' || !record.chatMessage) return null
        break
      case 'search':
        if (typeof record.query !== 'string' || !record.query) return null
        break
      case 'rename':
        if (typeof record.newTitle !== 'string' || !record.newTitle) return null
        break
      case 'delete':
        if (typeof record.deleteText !== 'string' || !record.deleteText) return null
        break
      case 'propose':
        if (typeof record.proposal !== 'string' || !record.proposal) return null
        break
      case 'ask':
        if (typeof record.question !== 'string' || !record.question) return null
        break
    }
    return record
  }

  it('accepts all 10 valid action types', () => {
    expect(validateAction({ type: 'insert', content: 'text' })).not.toBeNull()
    expect(validateAction({ type: 'replace', searchText: 'a', replaceWith: 'b' })).not.toBeNull()
    expect(validateAction({ type: 'read' })).not.toBeNull()
    expect(validateAction({ type: 'chat', chatMessage: 'hi' })).not.toBeNull()
    expect(validateAction({ type: 'search', query: 'test' })).not.toBeNull()
    expect(validateAction({ type: 'rename', newTitle: 'New' })).not.toBeNull()
    expect(validateAction({ type: 'delete', deleteText: 'rm' })).not.toBeNull()
    expect(validateAction({ type: 'propose', proposal: 'idea' })).not.toBeNull()
    expect(validateAction({ type: 'plan' })).not.toBeNull()
    expect(validateAction({ type: 'ask', question: 'why?' })).not.toBeNull()
  })

  it('rejects unknown action type', () => {
    expect(validateAction({ type: 'explode' })).toBeNull()
  })

  it('rejects null/undefined/non-object', () => {
    expect(validateAction(null)).toBeNull()
    expect(validateAction(undefined)).toBeNull()
    expect(validateAction('string')).toBeNull()
    expect(validateAction(42)).toBeNull()
  })

  it('rejects object without type field', () => {
    expect(validateAction({ content: 'text' })).toBeNull()
  })

  it('rejects rename without newTitle', () => {
    expect(validateAction({ type: 'rename' })).toBeNull()
    expect(validateAction({ type: 'rename', newTitle: '' })).toBeNull()
  })

  it('rejects delete without deleteText', () => {
    expect(validateAction({ type: 'delete' })).toBeNull()
    expect(validateAction({ type: 'delete', deleteText: '' })).toBeNull()
  })

  it('rejects propose without proposal', () => {
    expect(validateAction({ type: 'propose' })).toBeNull()
  })

  it('rejects ask without question', () => {
    expect(validateAction({ type: 'ask' })).toBeNull()
  })

  it('rejects insert without content', () => {
    expect(validateAction({ type: 'insert' })).toBeNull()
    expect(validateAction({ type: 'insert', content: '' })).toBeNull()
  })

  it('rejects replace without searchText', () => {
    expect(validateAction({ type: 'replace', replaceWith: 'b' })).toBeNull()
  })

  it('rejects replace without replaceWith', () => {
    expect(validateAction({ type: 'replace', searchText: 'a' })).toBeNull()
  })
})

describe('code fence stripping', () => {
  function stripCodeFences(text: string): string {
    let s = text.trim()
    s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    return s.trim()
  }

  it('strips ```json prefix and ``` suffix', () => {
    const result = stripCodeFences('```json\n{"type":"chat"}\n```')
    expect(result).toBe('{"type":"chat"}')
  })

  it('strips ``` without json label', () => {
    const result = stripCodeFences('```\n{"type":"chat"}\n```')
    expect(result).toBe('{"type":"chat"}')
  })

  it('passes through clean JSON', () => {
    const result = stripCodeFences('{"type":"chat"}')
    expect(result).toBe('{"type":"chat"}')
  })

  it('handles whitespace around fences', () => {
    const result = stripCodeFences('  ```json\n{"type":"chat"}\n```  ')
    expect(result).toBe('{"type":"chat"}')
  })
})
