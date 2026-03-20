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

// All API calls go through the server-side proxy which uses the Vercel AI SDK.
const API_URL = '/api/gemini'

// Client-side rate limiter: enforces minimum spacing between calls to stay within free tier limits.
// The server handles retries for transient errors via AI SDK's maxRetries.
// This limiter prevents the client from overwhelming the server with concurrent requests.
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

export type AgentActionType = 'insert' | 'replace' | 'read' | 'chat' | 'search' | 'rename' | 'delete' | 'propose' | 'plan' | 'ask' | 'image'

export interface AgentAction {
  type: AgentActionType
  position?: string
  content?: string
  searchText?: string
  replaceWith?: string
  highlightText?: string
  query?: string
  newTitle?: string
  deleteText?: string
  proposal?: string
  proposalType?: 'create-doc' | 'delete-doc' | 'add-agent' | 'remove-agent'
  steps?: string[]
  question?: string
  imagePrompt?: string
  imageCaption?: string
  chatBefore?: string
  chatMessage?: string
  thought?: string
  reasoning?: string[]
  shouldContinue?: boolean
}

import type { SessionPhase } from './phase-machine'
import type { AgentMode } from './agent-modes'

export type { SessionPhase }

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
  sessionTemplate?: string
  docStructure?: DocStructure
  phase?: SessionPhase
  docState?: 'blank' | 'template' | 'sparse' | 'content'
  agentMode?: AgentMode
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

export interface DocStructure {
  headings: string[]
  wordCounts: Record<string, number>
  totalWords: number
  avgSectionWords: number
  thinSections: string[]
  emptySections: string[]
  headingLevels: Record<string, number>
  hasIntro: boolean
  introWords: number
}

export function extractDocStructure(docText: string): DocStructure {
  const headings: string[] = []
  const wordCounts: Record<string, number> = {}
  const headingLevels: Record<string, number> = {}
  const plain = docText.replace(/<[^>]+>/g, '')
  const lines = plain.split('\n')
  let currentHeading = ''
  let currentWords = 0
  let introWords = 0
  let seenFirstHeading = false

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)/)
    if (match) {
      if (currentHeading) wordCounts[currentHeading] = currentWords
      else if (!seenFirstHeading) introWords = currentWords
      currentHeading = match[2].trim()
      headingLevels[currentHeading] = match[1].length
      headings.push(currentHeading)
      currentWords = 0
      seenFirstHeading = true
    } else {
      currentWords += line.trim().split(/\s+/).filter(Boolean).length
    }
  }
  if (currentHeading) wordCounts[currentHeading] = currentWords
  else if (!seenFirstHeading) introWords = currentWords

  const counts = Object.values(wordCounts)
  const totalWords = counts.reduce((a, b) => a + b, 0) + introWords
  const avgSectionWords = counts.length > 0 ? Math.round(totalWords / counts.length) : 0
  const threshold = Math.max(15, avgSectionWords * 0.3)

  const thinSections = headings.filter(h => (wordCounts[h] || 0) > 0 && (wordCounts[h] || 0) < threshold)
  const emptySections = headings.filter(h => (wordCounts[h] || 0) === 0)

  return {
    headings,
    wordCounts,
    totalWords,
    avgSectionWords,
    thinSections,
    emptySections,
    headingLevels,
    hasIntro: introWords > 0,
    introWords,
  }
}

export function buildPrompt(params: AskParams): string {
  const persona = params.persona || DEFAULT_PERSONAS[params.agentName] || DEFAULT_PERSONAS.Aiden
  const otherAgentList = params.otherAgents.filter(n => n !== params.agentName)
  const otherAgent = otherAgentList.length > 0 ? otherAgentList.join(', ') : 'the other agents'
  const recentChat = params.chatHistory.slice(-8).map(m => `${m.from}: ${m.text}`).join('\n')

  // Build rich context block
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
  if (params.sessionTemplate) {
    contextBlock += `\nDOC TYPE: ${params.sessionTemplate}`
  }

  // Rich document structure analysis
  const ds = params.docStructure
  if (ds && ds.headings.length > 0) {
    const outline = ds.headings
      .map(h => {
        const wc = ds.wordCounts[h] || 0
        const level = ds.headingLevels[h] || 2
        const indent = level > 1 ? '  ' : ''
        const flag = wc === 0 ? ' [EMPTY]' : wc < (ds.avgSectionWords * 0.3) ? ' [THIN]' : ''
        return `${indent}- ${h} (${wc} words)${flag}`
      })
      .join('\n')
    contextBlock += `\nDOC STRUCTURE (${ds.totalWords} total words, avg ${ds.avgSectionWords}/section):\n${outline}`
    if (ds.thinSections.length > 0) {
      contextBlock += `\nWEAK SECTIONS needing expansion: ${ds.thinSections.join(', ')}`
    }
    if (ds.emptySections.length > 0) {
      contextBlock += `\nEMPTY SECTIONS (placeholder only): ${ds.emptySections.join(', ')}`
    }
  }

  // Extract what other agents said/did recently for collaboration context
  const otherAgentMessages = params.chatHistory
    .filter(m => otherAgentList.includes(m.from))
    .slice(-3)
  if (otherAgentMessages.length > 0) {
    contextBlock += `\nRECENT CONTRIBUTIONS FROM COLLEAGUES:\n${otherAgentMessages.map(m => `  ${m.from}: ${m.text}`).join('\n')}`
  }

  // Discovery/planning phases: override task block to prevent doc edits and guide discovery
  const isPlanning = params.phase === 'discovery' || params.phase === 'planning'

  let taskBlock = ''
  if (isPlanning) {
    // Build a context-aware planning prompt based on doc state
    let planningContext = ''
    if (params.docState === 'blank') {
      planningContext = `The document is blank. The user just opened a new session but hasn't told you what they want to work on yet.

Your job: Ask what they want to create. Offer 2-3 concrete options based on your expertise. Be conversational, not robotic.
Example options might reference your specialty — if you're technical, suggest specs or architecture docs; if you're product-focused, suggest briefs or user research.`
    } else if (params.docState === 'template') {
      planningContext = `The document has a ${params.sessionTemplate || 'template'} template loaded, but the sections still have placeholder text. The user picked this template but hasn't started filling it in.

Your job: Acknowledge the template. Suggest which section to tackle first and why. Ask the user for the key context you need to start (e.g. "what's the product area?" or "what problem are we solving?").`
    } else if (params.docState === 'sparse') {
      planningContext = `The document has some content but it's thin — only a few sentences. The user may be drafting or just getting started.

Your job: Comment on what you see so far. Ask if there's a specific area they want help expanding. Offer a concrete suggestion based on what's already there.`
    }

    if (params.instruction) {
      planningContext += `\n\nThe instruction you received: "${params.instruction}"`
    }

    taskBlock = `PLANNING PHASE — You are helping the user figure out what to work on. DO NOT edit the document. Only use "chat", "ask", or "plan" actions.

${planningContext}

Rules for planning phase:
- Ask ONE focused question, not multiple
- If offering options, give 2-3 concrete choices (not generic)
- Reference the template structure if one exists
- Be conversational — like a coworker asking "what are we building?"
- NEVER use insert, replace, delete, or any doc-editing action
- Keep it short — one chat message, one question`
  } else if (params.trigger === 'autonomous') {
    taskBlock = `You are autonomously working on the document. Decide ONE useful action.

PRIORITY ORDER (do the first applicable):
1. If a section is marked [EMPTY] or [THIN], expand it with substantive content from your expertise area
2. If another agent made a claim you can evaluate, respond with evidence or a counterpoint
3. If you spot vague language ("various", "some", "significant"), replace it with specifics
4. If you notice a structural gap (e.g. technical spec without error handling, PRD without success metrics), fill it
5. If none of the above, read a section and comment with an observation or question

Available actions:
- Insert new content under a specific section heading
- Replace/improve vague or weak text with specific, concrete content
- Delete text that's redundant, outdated, or incorrect
- Read a section and comment in chat (use @mentions: "@Nova this needs user scenarios")
- Ask the user a clarifying question if intent is unclear
- Plan your approach for multiple changes (use "plan" then shouldContinue:true)
- Propose creating a new doc, adding/removing an agent
- Rename the document if the title doesn't match content

TURN LOGIC: React to the other agent's changes ONLY if you have something substantive to add, challenge, or build on. Substantive = new information, a specific counterpoint, or extending their work in a different direction. If you agree and have nothing to add, yield with shouldContinue:false.

IMPORTANT: Before inserting a heading, check DOC STRUCTURE above. If that heading exists, use "replace" or insert after it. NEVER create duplicate sections.

If the document title is "Untitled" and has content, use "rename" to suggest a better title.`
  } else if (params.trigger === 'instruction') {
    taskBlock = `The user said: "${params.instruction}"

Follow their instruction. Interpret contextually:
- "and another" / "one more" = repeat your last action type with new content
- "build this out" / "more" / "expand" = add depth to the section you last touched
- "@AgentName" = they're directing a specific agent
- Questions = answer in chat, don't edit the doc
- Short acknowledgments ("ok", "sure", "thanks") = respond in chat only

IMPORTANT: Always respond to the most recent context. Look at the LAST 2-3 chat messages for the current conversation thread — don't reply to something from earlier.`
  } else if (params.trigger === 'inline-doc') {
    taskBlock = `The user typed this directly in the document as an instruction to you: "${params.instruction}"

Act on it — add content, expand, rewrite, whatever they're asking. The instruction text itself should NOT appear in the document.`
  }

  // Inject agent mode modifier if available
  const modeBlock = params.agentMode
    ? `\n\nCURRENT MODE: ${params.agentMode.label}\n${params.agentMode.promptModifier}`
    : ''

  return `${persona}${modeBlock}

You are ${params.agentName} in a shared document workspace with ${otherAgent} and the user (${params.ownerName}). You are a team — reference each other's work, build on it, and push back when needed.

INTERACTION STYLE:
- Chat like a sharp coworker on Slack. Terse, direct, no filler. No emoji anywhere.
- Good: "solid section, but the latency numbers need a source" / "on it" / "@Nova the user flow misses the error state"
- Bad: "Great work! I think we should consider..." / "That's an interesting point..."
- When referencing another agent's work, quote the specific text or section name.

COLLABORATION RULES:
- When ${otherAgent} contributed recently, engage with their SPECIFIC content. Quote a phrase or section name.
- If they made a claim without evidence, challenge it: "where's this 40ms number from?"
- If they proposed something with tradeoffs, name the tradeoff: "faster but doubles memory usage"
- Build on their work by extending it in your specialty direction, not by restating it.
- At least 30% of responses should push back on something specific. Polite agreement without new info is wasted.
- If you agree fully, say so in ONE line and move to a different section or topic.

DOCUMENT WRITING RULES:
- Active voice. "The system processes requests" not "Requests are processed."
- Lead with the main point. Conclusion first, then evidence.
- Be specific. "Latency drops from 200ms to 40ms" not "Performance improves."
- Cut filler: very, really, basically, essentially, actually, in order to, it should be noted that.
- State what things ARE, not what they aren't.
- One idea per paragraph. Split if it covers two topics.
- Short sentences. Break compounds at the conjunction.
- BANNED WORDS: delve, leverage, multifaceted, foster, realm, tapestry, pivotal, crucial, robust, seamless, groundbreaking, cutting-edge, utilize, synergy, holistic, paradigm, ecosystem.
- Never start a section with "This section covers..." — just cover it.
- When adding bullets, include concrete details: names, numbers, protocols, specific examples.

DOCUMENT:
${truncateDoc(params.docText)}

RECENT CHAT (most recent at bottom — respond to the LAST message, not older ones):
${recentChat || '(no recent messages)'}
${contextBlock}

${taskBlock}

Choose ONE action. Use the following field names:
- type: one of insert, replace, read, chat, search, rename, delete, propose, plan, ask, image
- reasoning: array of 2-3 short steps (max 8 words each) showing your thinking
- thought: max 4 words
- For insert: position (e.g. "after:Heading" or "end"), content (plain text, ## for headings, - for bullets)
- For replace: searchText (exact match from doc), replaceWith
- For chat: chatMessage
- For search: query, shouldContinue (true)
- For read: highlightText
- For rename: newTitle
- For delete: deleteText
- For propose: proposalType (create-doc|delete-doc|add-agent|remove-agent), proposal
- For plan: steps (array), shouldContinue (true)
- For ask: question, chatMessage
- For image: imagePrompt, imageCaption, position
- chatBefore: REQUIRED for insert/replace (max 15 words)
- shouldContinue: usually false

${isPlanning ? 'PLANNING PHASE: Only use chat, ask, or plan actions. NO doc edits.' : ''}

Rules:
- Keep content terse. MAX 3-4 bullets per insert.
- NEVER create a heading that already exists.
- Keep total response concise.`
}

export async function askAgent(params: AskParams): Promise<AgentAction> {
  const ready = await rateLimiter.waitForSlot()
  if (!ready) throw new AgentError('Rate limiter disposed', 'rate_limit')

  const prompt = buildPrompt(params)
  const clientKey = getStoredApiKey()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (clientKey) headers['X-Gemini-Key'] = clientKey
  // Pass session context for server-side tracing
  const sessionMatch = window.location.pathname.match(/\/s\/([^/]+)/)
  if (sessionMatch) headers['X-Session-Id'] = sessionMatch[1]
  if (params.agentName) headers['X-Agent-Name'] = params.agentName

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt }),
    })

    if (res.status === 429) {
      rateLimiter.onRateLimit()
      throw new AgentError('Rate limit exceeded', 'rate_limit', 429, true)
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      rateLimiter.onError()
      throw new AgentError(
        errBody.error || `API error ${res.status}`,
        'api_error',
        res.status,
      )
    }

    rateLimiter.onSuccess()

    const data = await res.json()
    const action = data.action as AgentAction

    if (!action || !action.type) {
      throw new AgentError('Empty action from API', 'parse_error')
    }

    console.log('[agent]', params.agentName, action.type, action.thought, action.reasoning)

    // Post-process: trim thought and reasoning
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
    throw new AgentError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
      'network_error',
      undefined,
      true,
    )
  }
}

export function disposeRateLimiter() {
  rateLimiter.dispose()
}

export function resetRateLimiter() {
  rateLimiter.reset()
}
