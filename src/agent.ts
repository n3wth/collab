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

export type AgentActionType = 'insert' | 'replace' | 'read' | 'chat' | 'search' | 'rename' | 'delete' | 'propose' | 'plan' | 'ask' | 'image'

export interface AgentAction {
  type: AgentActionType
  position?: 'end' | 'after-heading' | 'cursor' | string
  content?: string
  searchText?: string
  replaceWith?: string
  highlightText?: string
  query?: string        // search query for web search action
  newTitle?: string     // for rename action
  deleteText?: string   // text to delete (for delete action)
  proposal?: string     // what the agent proposes (for propose action)
  proposalType?: 'create-doc' | 'delete-doc' | 'add-agent' | 'remove-agent'
  steps?: string[]      // planned steps (for plan action)
  question?: string     // clarifying question (for ask action)
  imagePrompt?: string  // detailed description of the image to generate
  imageCaption?: string // caption for the generated image
  chatBefore?: string   // message sent BEFORE the action (intent)
  chatMessage?: string  // message sent AFTER the action (summary)
  thought?: string
  reasoning?: string[]  // chain of thought steps shown transparently
  shouldContinue?: boolean
}

export type SessionPhase = 'planning' | 'active' | 'reviewing'

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
  thinSections: string[]       // sections with <30% of average word count
  emptySections: string[]      // sections with 0 words
  headingLevels: Record<string, number>  // heading name -> depth (1, 2, 3)
  hasIntro: boolean            // content before first heading
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

function buildPrompt(params: AskParams): string {
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

  // Planning phase: override task block to prevent doc edits and guide discovery
  const isPlanning = params.phase === 'planning'

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

  return `${persona}

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

Respond with a JSON object. Choose ONE action:
${isPlanning ? `
PLANNING PHASE — You may ONLY use these action types:

To respond in chat only:
{"type":"chat","reasoning":["<step>","<step>"],"chatMessage":"<your message>","shouldContinue":false}

To ask the user a clarifying question:
{"type":"ask","reasoning":["<step>","<step>"],"question":"<your question>","chatMessage":"<context for the question>"}

To outline a plan before making changes:
{"type":"plan","reasoning":["<step>","<step>"],"steps":["Step 1: ...","Step 2: ..."],"chatMessage":"<summary of plan>","shouldContinue":false}

DO NOT use insert, replace, delete, read, search, rename, or propose during planning.` : `
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

To delete specific text from the document:
{"type":"delete","reasoning":["<step>","<step>"],"deleteText":"<exact text to remove>","chatBefore":"<what you're removing and why>"}

To propose an action that needs user approval (create doc, add/remove agent):
{"type":"propose","reasoning":["<step>","<step>"],"proposalType":"<create-doc|delete-doc|add-agent|remove-agent>","proposal":"<what you're proposing and why>","chatMessage":"<ask for approval>"}

To outline a plan before making multiple changes:
{"type":"plan","reasoning":["<step>","<step>"],"steps":["Step 1: ...","Step 2: ..."],"chatMessage":"<summary of plan>","shouldContinue":true}

To ask the user a clarifying question before proceeding:
{"type":"ask","reasoning":["<step>","<step>"],"question":"<your question>","chatMessage":"<context for the question>"}

To generate and insert an image:
{"type":"image","reasoning":["<step>","<step>"],"imagePrompt":"<detailed description of the image to generate>","imageCaption":"<optional caption>","position":"<end OR after:Heading>","chatBefore":"<what you're generating>","shouldContinue":false}
Use image generation sparingly — only when a visual genuinely adds value: architecture diagrams, UI mockups, flowcharts, or when the user explicitly asks for an image.`}

Rules:
- "reasoning" is REQUIRED — 2-3 short steps showing your thinking. Each step MAX 8 words. Show: what you noticed -> what's missing -> what you'll do.
- "thought" must be MAX 4 words.
- "content" for inserts: plain text only. "## " for headings (NEVER ### or #). "- " for bullets. "  - " for sub-bullets. NEVER use **bold** or *italic*. MAX 3-4 bullets per action. Single \\n between lines. No extra whitespace.
- "chatBefore" is REQUIRED for insert/replace — announce intent. Be specific about WHAT and WHERE. MAX 15 words. Vary phrasing.
- "chatMessage" is optional. Only if you have something NEW to say after. MAX 15 words.
- "searchText" must be an EXACT substring from the document.
- "shouldContinue" usually false.
- "position": "after:Heading Text" to insert under a section. "end" to append. Prefer targeting a section.
- NEVER create a heading that already exists in the document.
- When mentioning someone in chat, no comma after the name.
- CRITICAL: Keep total JSON under 600 chars. Be terse.
- Return ONLY the JSON object`
}

const VALID_ACTION_TYPES = new Set(['insert', 'replace', 'read', 'chat', 'search', 'rename', 'delete', 'propose', 'plan', 'ask', 'image'])

// Strip markdown code fences and other wrapper noise that Gemini sometimes adds
function stripCodeFences(text: string): string {
  let s = text.trim()
  // Remove ```json or ``` prefix and trailing ```
  s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  // Remove leading prose before the JSON object (e.g. "Here is the response:\n{...")
  const firstBrace = s.indexOf('{')
  if (firstBrace > 0 && firstBrace < 80) {
    s = s.slice(firstBrace)
  }
  // Remove trailing prose after the JSON object
  const lastBrace = s.lastIndexOf('}')
  if (lastBrace >= 0 && lastBrace < s.length - 1) {
    s = s.slice(0, lastBrace + 1)
  }
  return s.trim()
}

// Normalize common LLM quirks in field names/values before validation
function normalizeAction(record: Record<string, unknown>): Record<string, unknown> {
  // Fix common type aliases
  if (record.type === 'comment' || record.type === 'message' || record.type === 'respond') {
    record.type = 'chat'
  }
  if (record.type === 'add' || record.type === 'write' || record.type === 'append') {
    record.type = 'insert'
  }
  if (record.type === 'edit' || record.type === 'update' || record.type === 'rewrite') {
    record.type = 'replace'
  }
  if (record.type === 'highlight' || record.type === 'observe' || record.type === 'review') {
    record.type = 'read'
  }
  if (record.type === 'question') {
    record.type = 'ask'
  }
  if (record.type === 'remove') {
    record.type = 'delete'
  }

  // Fix common field name typos
  if (record.search_text && !record.searchText) record.searchText = record.search_text
  if (record.replace_with && !record.replaceWith) record.replaceWith = record.replace_with
  if (record.chat_message && !record.chatMessage) record.chatMessage = record.chat_message
  if (record.chat_before && !record.chatBefore) record.chatBefore = record.chat_before
  if (record.highlight_text && !record.highlightText) record.highlightText = record.highlight_text
  if (record.should_continue !== undefined && record.shouldContinue === undefined) record.shouldContinue = record.should_continue
  if (record.new_title && !record.newTitle) record.newTitle = record.new_title
  if (record.delete_text && !record.deleteText) record.deleteText = record.delete_text
  if (record.proposal_type && !record.proposalType) record.proposalType = record.proposal_type

  // If chat type has content but no chatMessage, promote content to chatMessage
  if (record.type === 'chat' && !record.chatMessage && typeof record.content === 'string') {
    record.chatMessage = record.content
  }
  // If replace has content but no replaceWith, promote content to replaceWith
  if (record.type === 'replace' && !record.replaceWith && typeof record.content === 'string') {
    record.replaceWith = record.content
  }
  // If ask type has chatMessage but no question, promote it
  if (record.type === 'ask' && !record.question && typeof record.chatMessage === 'string') {
    record.question = record.chatMessage
  }

  return record
}

// Validate that a parsed object has required fields for its action type
function validateAction(obj: unknown): AgentAction | null {
  if (typeof obj !== 'object' || obj === null) return null

  const record = normalizeAction(obj as Record<string, unknown>)

  if (typeof record.type !== 'string') return null

  if (!VALID_ACTION_TYPES.has(record.type)) {
    // Last resort: if there's a chatMessage, treat as chat
    if (typeof record.chatMessage === 'string' && record.chatMessage) {
      record.type = 'chat'
    } else {
      console.warn('[agent] unknown action type, skipping:', record.type)
      return null
    }
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
    case 'rename':
      if (typeof record.newTitle !== 'string' || !record.newTitle) {
        console.warn('[agent] rename action missing newTitle')
        return null
      }
      break
    case 'delete':
      if (typeof record.deleteText !== 'string' || !record.deleteText) {
        console.warn('[agent] delete action missing deleteText')
        return null
      }
      break
    case 'propose':
      if (typeof record.proposal !== 'string' || !record.proposal) {
        console.warn('[agent] propose action missing proposal')
        return null
      }
      break
    case 'plan':
      if (!Array.isArray(record.steps) || record.steps.length === 0) {
        console.warn('[agent] plan action missing steps')
        return null
      }
      break
    case 'ask':
      if (typeof record.question !== 'string' || !record.question) {
        console.warn('[agent] ask action missing question')
        return null
      }
      break
    case 'image':
      if (typeof record.imagePrompt !== 'string' || !record.imagePrompt) {
        console.warn('[agent] image action missing imagePrompt')
        return null
      }
      break
  }

  return record as unknown as AgentAction
}

// Attempt to repair truncated JSON (close open strings/objects/arrays)
function repairJSON(raw: string): AgentAction | null {
  const text = stripCodeFences(raw)

  // Try as-is first
  try {
    const parsed = JSON.parse(text)
    return validateAction(parsed)
  } catch { /* continue */ }

  let fixed = text.trim()

  // Strategy 1: truncated mid-string — close open quotes, brackets, braces
  const quoteCount = (fixed.match(/(?<!\\)"/g) || []).length
  if (quoteCount % 2 !== 0) {
    fixed += '"'
  }

  // Close any open square brackets (arrays)
  const openBrackets = (fixed.match(/\[/g) || []).length
  const closeBrackets = (fixed.match(/\]/g) || []).length
  for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']'

  // Close any open braces
  const opens = (fixed.match(/\{/g) || []).length
  const closes = (fixed.match(/\}/g) || []).length
  for (let i = 0; i < opens - closes; i++) fixed += '}'

  try {
    const parsed = JSON.parse(fixed)
    const validated = validateAction(parsed)
    if (validated) return validated
  } catch { /* continue */ }

  // Strategy 2: remove trailing comma before closing brace (common LLM mistake)
  fixed = text.trim().replace(/,\s*$/, '')
  const q2 = (fixed.match(/(?<!\\)"/g) || []).length
  if (q2 % 2 !== 0) fixed += '"'
  const ob2 = (fixed.match(/\[/g) || []).length
  const cb2 = (fixed.match(/\]/g) || []).length
  for (let i = 0; i < ob2 - cb2; i++) fixed += ']'
  const o2 = (fixed.match(/\{/g) || []).length
  const c2 = (fixed.match(/\}/g) || []).length
  for (let i = 0; i < o2 - c2; i++) fixed += '}'

  try {
    const parsed = JSON.parse(fixed)
    const validated = validateAction(parsed)
    if (validated) return validated
  } catch { /* continue */ }

  // Strategy 3: truncated after a comma or colon — cut at last complete pair
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
              const validated = validateAction(parsed)
              if (validated) return validated
            } catch { /* continue */ }
          }
        }
      }
    }
  }

  // Strategy 4: extract just the type and any chat content for a minimal fallback
  const typeMatch = text.match(/"type"\s*:\s*"(\w+)"/)
  const msgMatch = text.match(/"chatMessage"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (typeMatch) {
    const fallback: Record<string, unknown> = { type: typeMatch[1] }
    if (msgMatch) fallback.chatMessage = msgMatch[1]
    const contentMatch = text.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (contentMatch) fallback.content = contentMatch[1]
    const searchMatch = text.match(/"searchText"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (searchMatch) fallback.searchText = searchMatch[1]
    const replaceMatch = text.match(/"replaceWith"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (replaceMatch) fallback.replaceWith = replaceMatch[1]
    const posMatch = text.match(/"position"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (posMatch) fallback.position = posMatch[1]
    const highlightMatch = text.match(/"highlightText"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (highlightMatch) fallback.highlightText = highlightMatch[1]
    const queryMatch = text.match(/"query"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (queryMatch) fallback.query = queryMatch[1]
    const validated = validateAction(fallback)
    if (validated) {
      console.warn('[agent] recovered action via regex fallback:', validated.type)
      return validated
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
