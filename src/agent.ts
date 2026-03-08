const DEV_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
const MODEL = 'gemini-2.5-flash'
// In production, use serverless proxy (no API key on client). In dev, call Gemini directly.
const DIRECT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${DEV_API_KEY || ''}`
const PROXY_URL = '/api/gemini'
const API_URL = DEV_API_KEY ? DIRECT_URL : PROXY_URL

// Rate limiter: tracks calls, enforces spacing, handles 429 backoff
const rateLimiter = {
  lastCallTime: 0,
  minIntervalMs: 7000,  // min 7s between calls (~8 RPM, safe under 10 RPM free tier)
  backoffUntil: 0,
  consecutiveErrors: 0,
  maxRetries: 3,

  async waitForSlot(): Promise<boolean> {
    // If we're in backoff, check if it's expired
    if (Date.now() < this.backoffUntil) {
      const wait = this.backoffUntil - Date.now()
      console.log(`[rate] backing off for ${Math.round(wait / 1000)}s`)
      await new Promise(r => setTimeout(r, wait))
    }

    // Enforce minimum interval between calls
    const elapsed = Date.now() - this.lastCallTime
    if (elapsed < this.minIntervalMs) {
      await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed))
    }

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
    return this.consecutiveErrors < this.maxRetries
  },
}

export interface AgentAction {
  type: 'insert' | 'replace' | 'read' | 'chat'
  position?: 'end' | 'after-heading' | 'cursor' | string
  content?: string
  searchText?: string
  replaceWith?: string
  highlightText?: string
  chatBefore?: string   // message sent BEFORE the action (intent)
  chatMessage?: string  // message sent AFTER the action (summary)
  thought?: string
  shouldContinue?: boolean
}

export interface AskParams {
  agentName: string
  ownerName: string
  docText: string
  chatHistory: { from: string, text: string }[]
  trigger: 'autonomous' | 'instruction' | 'inline-doc'
  instruction?: string
  recentChange?: string  // what was just edited and by whom
  otherAgentLastAction?: string  // what the other agent just did
  lockHolder?: string | null  // which agent currently holds the editor lock
}

const AGENT_PERSONAS: Record<string, string> = {
  Aiden: `You are Aiden, a collaborative AI agent owned by "You" (the user). You have deep technical architecture and engineering background — you think in systems, APIs, data models, and implementation details. You write precise technical prose: specifications, architecture decisions, interface contracts. When you contribute to a doc, you add concrete technical substance — specific protocols, data flows, component boundaries, performance considerations. You're the one who turns vague ideas into buildable specs.`,
  Nova: `You are Nova, a collaborative AI agent owned by Sarah. You have a background in product strategy and user research — you think in user journeys, adoption curves, market positioning, and behavioral psychology. You're excellent at identifying gaps in thinking, asking "what about..." questions, and grounding technical ideas in real user needs. When you contribute to a doc, you add user scenarios, edge cases, adoption risks, and strategic framing. You're the one who makes sure the thing being built actually matters to people.`,
}

function truncateDoc(text: string, maxChars = 2000): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n[...truncated]'
}

function buildPrompt(params: AskParams): string {
  const persona = AGENT_PERSONAS[params.agentName] || AGENT_PERSONAS.Aiden
  const otherAgent = params.agentName === 'Aiden' ? 'Nova (Sarah\'s agent)' : 'Aiden (the user\'s agent)'
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

Chat style: casual, like a coworker on Slack. Occasionally (maybe 1 in 4 messages) use a single emoji naturally — e.g. "nice, this section is solid now" or "on it" or "hmm @Nova what about edge cases here?". Don't overdo it. Never use emoji in document content — only in chatBefore/chatMessage.

DOCUMENT:
${truncateDoc(params.docText)}

RECENT CHAT (most recent at bottom — respond to the LAST message, not older ones):
${recentChat || '(no recent messages)'}
${contextBlock}

${taskBlock}

Respond with a JSON object. Choose ONE action:

To read/highlight a section (no edit):
{"type":"read","highlightText":"<exact text from doc to highlight>","thought":"<what you notice about it>","shouldContinue":false}

To insert new content:
{"type":"insert","position":"<end|after-heading>","content":"<text to insert — use \\n for new lines, ## for headings, - for bullets. NO ### or **bold** — only ## and plain text>","thought":"<brief thought>","chatBefore":"<what you're about to do — say this BEFORE editing>","chatMessage":"<optional summary AFTER editing>","shouldContinue":false}

To replace existing text:
{"type":"replace","searchText":"<exact text to find in doc>","replaceWith":"<replacement text>","thought":"<brief thought>","chatBefore":"<what you're about to change>","chatMessage":"<optional summary after>","shouldContinue":false}

To respond in chat only:
{"type":"chat","chatMessage":"<your message>","shouldContinue":false}

Rules:
- "thought" must be MAX 4 words.
- "content" for inserts: plain text only. Use "## " for headings (NEVER ### or #). Use "- " for top-level bullets. Use "  - " (two spaces then dash) for sub-bullets. NEVER use **bold** or *italic* markdown. MAX 3-4 bullets per action.
- "chatBefore" is REQUIRED for insert/replace — announce intent naturally. Examples: "Adding the data model under Aiden's architecture section", "Fleshing out the trust arc — @Aiden this connects to your sync protocol", "Rewriting the overview to be more specific". Be specific about WHAT and WHERE. MAX 15 words. Vary your phrasing — don't start every message with "Adding" or "Building on".
- "chatMessage" is optional. Only include if you have something NEW to say after (e.g. a question for the other agent, a flag for the team). Don't just restate what chatBefore said. MAX 15 words.
- "searchText" must be an EXACT substring.
- "shouldContinue" usually false.
- NEVER create a section heading that already exists in the document. Add content under existing headings instead.
- When mentioning someone in chat, don't put a comma right after the name. Write "@Nova what do you think" not "@Nova, what do you think".
- CRITICAL: Keep total JSON under 500 chars. Be terse.
- Return ONLY the JSON object`
}

// Attempt to repair truncated JSON (close open strings/objects)
function repairJSON(text: string): AgentAction | null {
  // Try as-is first
  try { return JSON.parse(text) } catch { /* continue */ }

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
    if (parsed.type) return parsed as AgentAction
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
              if (parsed.type) return parsed as AgentAction
            } catch { /* continue */ }
          }
        }
      }
    }
  }

  return null
}

export async function askAgent(params: AskParams): Promise<AgentAction> {
  await rateLimiter.waitForSlot()

  for (let attempt = 0; attempt <= rateLimiter.maxRetries; attempt++) {
    try {
      const prompt = buildPrompt(params)
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.7,
            maxOutputTokens: 1200, // enough for JSON action responses with content
          },
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
        console.error('[agent] rate limit exhausted, using fallback')
        return fallbackAction(params)
      }

      if (!res.ok) {
        const errText = await res.text()
        console.error('[agent] API error:', res.status, errText.slice(0, 200))
        rateLimiter.onError()
        if (rateLimiter.shouldRetry()) {
          await rateLimiter.waitForSlot()
          continue
        }
        return fallbackAction(params)
      }

      rateLimiter.onSuccess()

      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) {
        console.warn('[agent] no text in response', JSON.stringify(data).slice(0, 200))
        return fallbackAction(params)
      }

      const action = repairJSON(text)
      if (!action || !action.type) {
        console.warn('[agent] unparseable response:', text.slice(0, 200))
        return fallbackAction(params)
      }
      console.log('[agent]', params.agentName, action.type, action.thought)
      if (action.thought) {
        action.thought = action.thought.split(/\s+/).slice(0, 4).join(' ')
      }
      return action
    } catch (err) {
      console.error('[agent] catch error:', err)
      rateLimiter.onError()
      if (attempt < rateLimiter.maxRetries) {
        await rateLimiter.waitForSlot()
        continue
      }
      return fallbackAction(params)
    }
  }

  return fallbackAction(params)
}

function fallbackAction(params: AskParams): AgentAction {
  return {
    type: 'read',
    highlightText: params.docText.split('\n').filter(l => l.trim())[0]?.slice(0, 30) || 'document',
    thought: 'Reviewing...',
    shouldContinue: false,
  }
}
