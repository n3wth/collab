export class AgentError extends Error {
  readonly code: 'rate_limit' | 'api_error' | 'parse_error' | 'network_error'
  readonly status: number | undefined
  readonly retryable: boolean

  constructor(
    message: string,
    code: 'rate_limit' | 'api_error' | 'parse_error' | 'network_error',
    status?: number,
    retryable = false,
  ) {
    super(message)
    this.name = 'AgentError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

import { getStoredApiKey } from './AgentConfigurator'

// All API calls go through the server-side proxy to avoid exposing API keys in the client bundle.
const API_URL = '/api/gemini'

// Rate limiter: tracks calls, enforces spacing, handles 429 backoff
const rateLimiter = {
  lastCallTime: 0,
  minIntervalMs: 7000,  // min 7s between calls (~8 RPM, safe under 10 RPM free tier)
  backoffUntil: 0,
  consecutiveErrors: 0,
  maxRetries: 3,
  pendingTimers: new Set<ReturnType<typeof setTimeout>>(),
  disposed: false,

  async waitForSlot(): Promise<boolean> {
    if (this.disposed) return false

    // If we're in backoff, check if it's expired
    if (Date.now() < this.backoffUntil) {
      const wait = this.backoffUntil - Date.now()
      console.log(`[rate] backing off for ${Math.round(wait / 1000)}s`)
      await new Promise<void>((resolve) => {
        const id = setTimeout(() => { this.pendingTimers.delete(id); resolve() }, wait)
        this.pendingTimers.add(id)
      })
    }

    if (this.disposed) return false

    // Enforce minimum interval between calls
    const elapsed = Date.now() - this.lastCallTime
    if (elapsed < this.minIntervalMs) {
      await new Promise<void>((resolve) => {
        const id = setTimeout(() => { this.pendingTimers.delete(id); resolve() }, this.minIntervalMs - elapsed)
        this.pendingTimers.add(id)
      })
    }

    if (this.disposed) return false

    this.lastCallTime = Date.now()
    return true
  },

  onSuccess() {
    this.consecutiveErrors = 0
  },

  onRateLimit() {
    this.consecutiveErrors++
    const backoffSec = Math.min(60, 5 * Math.pow(2, this.consecutiveErrors - 1))
    this.backoffUntil = Date.now() + backoffSec * 1000
    console.warn(`[rate] 429 hit, backing off ${backoffSec}s (attempt ${this.consecutiveErrors})`)
  },

  onError() {
    this.consecutiveErrors++
    if (this.consecutiveErrors >= this.maxRetries) {
      this.backoffUntil = Date.now() + 30000
      console.warn('[rate] too many errors, cooling down 30s')
    }
  },

  shouldRetry(): boolean {
    return this.consecutiveErrors < this.maxRetries && !this.disposed
  },

  dispose() {
    this.disposed = true
    this.pendingTimers.forEach(id => clearTimeout(id))
    this.pendingTimers.clear()
  },

  reset() {
    this.pendingTimers.forEach(id => clearTimeout(id))
    this.pendingTimers.clear()
    this.disposed = false
    this.consecutiveErrors = 0
    this.backoffUntil = 0
    this.lastCallTime = 0
  },
}

export interface AgentAction {
  type: 'insert' | 'replace' | 'read' | 'chat' | 'search' | 'rename'
  position?: 'end' | 'after-heading' | 'cursor' | string
  content?: string
  searchText?: string
  replaceWith?: string
  highlightText?: string
  query?: string        // search query for web search action
  newTitle?: string     // for rename action
  chatBefore?: string   // message sent BEFORE the action (intent)
  chatMessage?: string  // message sent AFTER the action (summary)
  thought?: string
  reasoning?: string[]  // chain of thought steps shown transparently
  shouldContinue?: boolean
}

export interface AskParams {
  agentName: string
  ownerName: string
  docText: string
  chatHistory: { from: string, text: string }[]
  trigger: 'autonomous' | 'instruction' | 'inline-doc'
  instruction?: string
  recentChange?: string
  otherAgentLastAction?: string
  lockHolder?: string | null
  persona: string
  otherAgents: string[]
}

// Default personas kept for backward compatibility
export const DEFAULT_PERSONAS: Record<string, string> = {
  Aiden: `You are Aiden, a collaborative AI agent who writes with technical precision. You think in systems, APIs, data models, and implementation trade-offs. You add concrete substance to documents: specific protocols, data flows, component boundaries, failure modes, and performance constraints. You turn vague ideas into buildable specifications. When you see hand-waving, you replace it with numbers, diagrams, or interface contracts. Your writing is tight — every sentence carries information.`,
  Nova: `You are Nova, a collaborative AI agent who writes from the user's perspective. You think in user journeys, adoption curves, market positioning, and behavioral psychology. You challenge assumptions by asking "who benefits?" and "what breaks?". You add user scenarios, edge cases, adoption risks, and competitive framing to documents. When you see a technical spec without a user story, you write one. Your writing is clear and direct — you make the case, then stop.`,
}

function truncateDoc(text: string, maxChars = 2000): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n[...truncated]'
}

function buildPrompt(params: AskParams): string {
  const persona = params.persona || DEFAULT_PERSONAS[params.agentName] || DEFAULT_PERSONAS.Aiden
  const otherAgentList = params.otherAgents.filter(n => n !== params.agentName)
  const otherAgent = otherAgentList.length > 0 ? otherAgentList.join(', ') : 'the other agents'
  const recentChat = params.chatHistory.slice(-6).map(m => `${m.from}: ${m.text}`).join('\n')

  let contextBlock = ''
  if (params.recentChange) {
    contextBlock += `\nRECENT CHANGE: ${params.recentChange}`
  }
  if (params.otherAgentLastAction) {
    contextBlock += `\nOTHER AGENT JUST DID: ${params.otherAgentLastAction}`
  }
  if (params.lockHolder) {
    contextBlock += `\nEDITOR LOCK: Currently held by ${params.lockHolder}`
  }

  let taskBlock = ''
  if (params.trigger === 'autonomous') {
    taskBlock = `You are autonomously working on the document. Decide ONE useful action:
- Read a specific part and comment on it in chat (tag the other agent if relevant, e.g. "@Nova this section needs user scenarios")
- Insert new content that builds on or complements what the other agent wrote
- Replace/improve existing text
- Send a chat message reacting to something the other agent added (use @mentions)

Prefer actions that reference or build on the other agent's work. Be concise — max 3-4 bullets per insert. IMPORTANT: Before inserting a new heading, check if that heading already exists in the document. If it does, add content UNDER the existing heading using "replace" or insert after it — do NOT create a duplicate section.`
  } else if (params.trigger === 'instruction') {
    taskBlock = `The user said: "${params.instruction}"

Follow their instruction. Interpret contextually — "and another" means repeat your last action type, "build this out" or "more" means expand with new content, "@aiden" or "@nova" means they're talking to a specific agent. If it's conversational, respond in chat only.

IMPORTANT: Always respond to the most recent context. If someone mentioned you, look at the LAST few chat messages to understand the current conversation — don't reply to something from 5 messages ago.`
  } else if (params.trigger === 'inline-doc') {
    taskBlock = `The user typed this directly in the document as an instruction to you: "${params.instruction}"

Act on it — add content, expand, rewrite, whatever they're asking. The instruction text itself should NOT appear in the document.`
  }

  return `${persona}

You're in a shared document with other people and agents. The other agent is ${otherAgent}. You should actively interact — comment on each other's additions, build on what the other wrote, ask questions with @mentions in chat (e.g. "@Nova what about..." or "@Aiden can you spec..."). Reference specific content the other agent added. You're a team, not working in isolation.

Chat style: casual, like a coworker on Slack. Concise and direct. No emoji anywhere — not in chat, not in documents. Examples: "nice, this section is solid now" or "on it" or "hmm @Nova what about edge cases here?".

Collaboration: When ${otherAgent} contributed recently, reference their work specifically. Build on it or push back with reasoning. If you agree, say so briefly and add something new — never restate what was already said. Keep your voice distinct from theirs.

Critical thinking: You MUST evaluate the other agent's contributions critically. If ${otherAgent} made a claim without evidence, challenge it. If they proposed an approach with clear downsides, name those downsides. Constructive disagreement is more valuable than polite agreement. At least 30% of your responses should push back on something specific.

Writing rules for document content:
- Use active voice. "The system processes requests" not "Requests are processed by the system."
- Lead each paragraph with its main point. Put the conclusion first, then the evidence.
- Be specific and concrete. "Latency drops from 200ms to 40ms" not "Performance improves significantly."
- Cut filler words: very, really, basically, essentially, actually, in order to, it should be noted that.
- State what things ARE, not what they are not. "Use PostgreSQL" not "Don't use a NoSQL database."
- One idea per paragraph. If a paragraph covers two topics, split it.
- Prefer short sentences. Break long compound sentences at the conjunction.
- Never use: delve, leverage, multifaceted, foster, realm, tapestry, pivotal, crucial, robust, seamless, groundbreaking, cutting-edge.
- Never start a section with "This section covers..." — just cover it.

DOCUMENT:
${truncateDoc(params.docText)}

RECENT CHAT (most recent at bottom — respond to the LAST message, not older ones):
${recentChat || '(no recent messages)'}
${contextBlock}

${taskBlock}

Respond with a JSON object. Choose ONE action:

To read/highlight a section (no edit):
{"type":"read","reasoning":["<step>","<step>"],"highlightText":"<exact text from doc to highlight>","thought":"<4 words>","shouldContinue":false}

To insert new content:
{"type":"insert","reasoning":["<step>","<step>"],"position":"<end OR after:Exact Heading Text>","content":"<text to insert — use \\n for new lines, ## for headings, - for bullets. NO ### or **bold** — only ## and plain text>","thought":"<4 words>","chatBefore":"<what you're about to do>","chatMessage":"<optional summary>","shouldContinue":false}

To replace existing text:
{"type":"replace","reasoning":["<step>","<step>"],"searchText":"<exact text to find in doc>","replaceWith":"<replacement text>","thought":"<4 words>","chatBefore":"<what you're about to change>","chatMessage":"<optional summary>","shouldContinue":false}

To respond in chat only:
{"type":"chat","reasoning":["<step>","<step>"],"chatMessage":"<your message>","shouldContinue":false}

To search the web for current information:
{"type":"search","reasoning":["<step>","<step>"],"query":"<search query>","thought":"<4 words>","shouldContinue":true}
Use search when the document needs current data, market info, or technical research. After search results appear, synthesize the key findings into a brief insight — never relay raw search results to the user.

To rename the document when the title doesn't match its content:
{"type":"rename","reasoning":["<step>","<step>"],"newTitle":"<better title>","chatMessage":"<explanation>"}

Rules:
- "reasoning" is REQUIRED — 2-3 short steps showing your thinking process. Each step MAX 8 words. Examples: ["Architecture section lacks specifics", "Need CRDT sync protocol details", "Adding data model and sync flow"]. Show what you noticed, what's missing, and what you'll do.
- "thought" must be MAX 4 words.
- "content" for inserts: plain text only. Use "## " for headings (NEVER ### or #). Use "- " for top-level bullets. Use "  - " (two spaces then dash) for sub-bullets. NEVER use **bold** or *italic* markdown. MAX 3-4 bullets per action. NEVER insert blank lines between paragraphs — single \\n only. No extra whitespace.
- "chatBefore" is REQUIRED for insert/replace — announce intent naturally. Be specific about WHAT and WHERE. MAX 15 words. Vary your phrasing.
- "chatMessage" is optional. Only include if you have something NEW to say after. MAX 15 words.
- "searchText" must be an EXACT substring.
- "shouldContinue" usually false.
- "position": Use "after:Heading Text" to insert UNDER a specific section (e.g. "after:Architecture"). Use "end" to append at the document end. Prefer targeting a specific section over appending.
- NEVER create a section heading that already exists in the document.
- When mentioning someone in chat, don't put a comma right after the name.
- CRITICAL: Keep total JSON under 600 chars. Be terse.
- Return ONLY the JSON object`
}

const VALID_ACTION_TYPES = new Set(['insert', 'replace', 'read', 'chat', 'search'])

// Strip markdown code fences that Gemini sometimes wraps around JSON
function stripCodeFences(text: string): string {
  let s = text.trim()
  // Remove ```json or ``` prefix and trailing ```
  s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  return s.trim()
}

// Validate that a parsed object has required fields for its action type
function validateAction(obj: unknown): AgentAction | null {
  if (typeof obj !== 'object' || obj === null) return null

  const record = obj as Record<string, unknown>

  if (typeof record.type !== 'string') return null

  if (!VALID_ACTION_TYPES.has(record.type)) {
    console.warn('[agent] unknown action type, skipping:', record.type)
    return null
  }

  // Validate required fields per action type
  switch (record.type) {
    case 'insert':
      if (typeof record.content !== 'string' || !record.content) {
        console.warn('[agent] insert action missing content')
        return null
      }
      if (record.position !== undefined && typeof record.position !== 'string') {
        console.warn('[agent] insert action has invalid position')
        return null
      }
      break
    case 'replace':
      if (typeof record.searchText !== 'string' || !record.searchText) {
        console.warn('[agent] replace action missing searchText')
        return null
      }
      if (typeof record.replaceWith !== 'string') {
        console.warn('[agent] replace action missing replaceWith')
        return null
      }
      break
    case 'read':
      // highlightText is optional but should be string if present
      if (record.highlightText !== undefined && typeof record.highlightText !== 'string') {
        console.warn('[agent] read action has invalid highlightText')
        return null
      }
      break
    case 'chat':
      if (typeof record.chatMessage !== 'string' || !record.chatMessage) {
        console.warn('[agent] chat action missing chatMessage')
        return null
      }
      break
    case 'search':
      if (typeof record.query !== 'string' || !record.query) {
        console.warn('[agent] search action missing query')
        return null
      }
      break
  }

  return obj as AgentAction
}

// Attempt to repair truncated JSON (close open strings/objects)
function repairJSON(raw: string): AgentAction | null {
  const text = stripCodeFences(raw)

  // Try as-is first
  try {
    const parsed = JSON.parse(text)
    return validateAction(parsed)
  } catch { /* continue */ }

  let fixed = text.trim()

  // Strategy 1: truncated mid-string — close the string, add missing fields, close object
  // Find if we're inside an unclosed string value
  const quoteCount = (fixed.match(/(?<!\\)"/g) || []).length
  if (quoteCount % 2 !== 0) {
    // We're mid-string. Close it and try to close the object
    fixed += '"'
  }

  // Close any open braces
  const opens = (fixed.match(/\{/g) || []).length
  const closes = (fixed.match(/\}/g) || []).length
  for (let i = 0; i < opens - closes; i++) fixed += '}'

  try {
    const parsed = JSON.parse(fixed)
    const validated = validateAction(parsed)
    if (validated) return validated
  } catch { /* continue */ }

  // Strategy 2: truncated after a comma or colon — remove trailing garbage and close
  fixed = text.trim()
  // Remove trailing partial key-value (after last complete "key":"value")
  const lastCompleteValue = fixed.lastIndexOf('","')
  if (lastCompleteValue > 0) {
    // Find the end of that value
    const afterComma = fixed.indexOf('"', lastCompleteValue + 2)
    if (afterComma > 0) {
      const afterColon = fixed.indexOf(':', afterComma)
      if (afterColon > 0) {
        // Check if the value after colon is incomplete
        const valueStart = fixed.indexOf('"', afterColon)
        if (valueStart > 0) {
          const valueEnd = fixed.indexOf('"', valueStart + 1)
          if (valueEnd < 0) {
            // Truncated mid-value — cut at the last complete pair
            fixed = fixed.slice(0, lastCompleteValue + 1) + '}'
            try {
              const parsed = JSON.parse(fixed)
              const validated = validateAction(parsed)
              if (validated) return validated
            } catch { /* continue */ }
          }
        }
      }
    }
  }

  return null
}

export async function askAgent(params: AskParams): Promise<AgentAction> {
  const ready = await rateLimiter.waitForSlot()
  if (!ready) throw new AgentError('Rate limiter disposed', 'rate_limit')

  for (let attempt = 0; attempt <= rateLimiter.maxRetries; attempt++) {
    try {
      const prompt = buildPrompt(params)
      const clientKey = getStoredApiKey()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (clientKey) headers['X-Gemini-Key'] = clientKey
      const res = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.7,
            maxOutputTokens: 1200,
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
          ],
        }),
      })

      if (res.status === 429) {
        // Parse retryDelay from error body if available
        try {
          const errBody = await res.json()
          const retryDetail = errBody?.error?.details?.find((d: Record<string, unknown>) => d.retryDelay)
          if (retryDetail?.retryDelay) {
            const delaySec = parseFloat(retryDetail.retryDelay) || 10
            rateLimiter.backoffUntil = Date.now() + delaySec * 1000
            console.warn(`[rate] server says retry after ${delaySec}s`)
          }
        } catch { /* ignore parse errors */ }
        rateLimiter.onRateLimit()
        if (rateLimiter.shouldRetry()) {
          await rateLimiter.waitForSlot()
          continue
        }
        throw new AgentError('Rate limit exhausted after retries', 'rate_limit', 429)
      }

      if (!res.ok) {
        const errText = await res.text()
        console.error('[agent] API error:', res.status, errText.slice(0, 200))
        rateLimiter.onError()
        if (rateLimiter.shouldRetry()) {
          await rateLimiter.waitForSlot()
          continue
        }
        throw new AgentError(
          `API error ${res.status}: ${errText.slice(0, 200)}`,
          'api_error',
          res.status,
        )
      }

      rateLimiter.onSuccess()

      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) {
        const detail = JSON.stringify(data).slice(0, 200)
        console.warn('[agent] no text in response', detail)
        throw new AgentError(`Empty response from API: ${detail}`, 'api_error')
      }

      const action = repairJSON(text)
      if (!action || !action.type) {
        console.warn('[agent] unparseable response:', text.slice(0, 200))
        throw new AgentError(`Unparseable response: ${text.slice(0, 100)}`, 'parse_error')
      }
      console.log('[agent]', params.agentName, action.type, action.thought, action.reasoning)
      if (action.thought) {
        action.thought = action.thought.split(/\s+/).slice(0, 4).join(' ')
      }
      if (action.reasoning && Array.isArray(action.reasoning)) {
        action.reasoning = action.reasoning.slice(0, 3).map(s => String(s).slice(0, 60))
      }
      return action
    } catch (err) {
      if (err instanceof AgentError) throw err
      console.error('[agent] catch error:', err)
      if (err instanceof TypeError && (err as TypeError).message === 'Failed to fetch') {
        console.error(
          '[agent] Could not reach the API proxy at /api/gemini. ' +
          'Make sure the server-side proxy is running and GEMINI_API_KEY is set in your environment.'
        )
      }
      rateLimiter.onError()
      if (attempt < rateLimiter.maxRetries) {
        await rateLimiter.waitForSlot()
        continue
      }
      throw new AgentError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        'network_error',
        undefined,
        true,
      )
    }
  }

  throw new AgentError('All retry attempts exhausted', 'api_error')
}

export function disposeRateLimiter() {
  rateLimiter.dispose()
}

export function resetRateLimiter() {
  rateLimiter.reset()
}
