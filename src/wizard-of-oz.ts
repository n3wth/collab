/**
 * Wizard of Oz — scripted proactive agent behaviors.
 * Detects doc/chat patterns and surfaces observations without LLM calls.
 */

import type { SessionPhase } from './phase-machine'

export interface WizardObservation {
  agent: string
  type: 'chat'
  text: string
  delay: number
}

const delivered = new Set<string>()

export function resetWizard(): void {
  delivered.clear()
}

// Detect vague quantifiers and weasel words that could be more specific
function findVagueLanguage(plain: string): string[] {
  const vaguePatterns = [
    /\b(various|several|many|some|numerous|a number of|a lot of)\s+\w+/gi,
    /\b(significant(?:ly)?|substantial(?:ly)?|considerable|considerable)\b/gi,
    /\b(quickly|slowly|soon|recently|eventually|often|sometimes|rarely)\b/gi,
    /\b(improve[sd]?|enhance[sd]?|better|worse|faster|slower)\b(?!\s+(?:by|from|to)\s+\d)/gi,
    /\b(etc\.?|and so on|and more|among others)\b/gi,
  ]
  const matches: string[] = []
  for (const pat of vaguePatterns) {
    const found = plain.match(pat)
    if (found) matches.push(...found.slice(0, 3))
  }
  return [...new Set(matches)].slice(0, 5)
}

// Detect potential contradictions by finding conflicting statements
function findContradictions(plain: string): string[] {
  const lines = plain.split(/[.\n]/).map(l => l.trim()).filter(Boolean)
  const contradictions: string[] = []

  // Look for numeric contradictions (same noun with different numbers)
  const numericClaims: Record<string, { value: string, line: string }[]> = {}
  for (const line of lines) {
    const matches = line.matchAll(/(\w+(?:\s+\w+)?)\s+(?:is|are|was|were|of|at|takes?|costs?|requires?)\s+(?:about\s+)?(\d+[\d,.]*\s*(?:%|ms|s|seconds|minutes|hours|days|weeks|months|users|requests|bytes|[KMGT]B)?)/gi)
    for (const m of matches) {
      const noun = m[1].toLowerCase()
      const value = m[2].trim()
      if (!numericClaims[noun]) numericClaims[noun] = []
      numericClaims[noun].push({ value, line: line.slice(0, 60) })
    }
  }
  for (const [noun, claims] of Object.entries(numericClaims)) {
    if (claims.length >= 2) {
      const values = claims.map(c => c.value)
      const unique = [...new Set(values)]
      if (unique.length > 1) {
        contradictions.push(`"${noun}" has conflicting values: ${unique.join(' vs ')}`)
      }
    }
  }

  // Look for direct negation patterns
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      const a = lines[i].toLowerCase()
      const b = lines[j].toLowerCase()
      // "X should Y" vs "X should not Y"
      if (a.includes('should') && b.includes('should not') || a.includes('should not') && b.includes('should')) {
        const aSubj = a.match(/(\w+)\s+should/)?.[1]
        const bSubj = b.match(/(\w+)\s+should/)?.[1]
        if (aSubj && bSubj && aSubj === bSubj) {
          contradictions.push(`conflicting "should" statements about "${aSubj}"`)
        }
      }
    }
  }

  return contradictions.slice(0, 3)
}

// Detect sections that are disproportionately short vs the document average
function findDisproportionateSections(docText: string): { section: string, words: number, avg: number }[] {
  const plain = docText.replace(/<[^>]+>/g, '')
  const lines = plain.split('\n')
  const sections: { name: string, words: number }[] = []
  let current = ''
  let words = 0

  for (const line of lines) {
    const match = line.match(/^#{1,3}\s+(.+)/)
    if (match) {
      if (current) sections.push({ name: current, words })
      current = match[1].trim()
      words = 0
    } else {
      words += line.trim().split(/\s+/).filter(Boolean).length
    }
  }
  if (current) sections.push({ name: current, words })

  if (sections.length < 3) return []

  const avg = Math.round(sections.reduce((a, s) => a + s.words, 0) / sections.length)
  if (avg < 20) return []

  return sections
    .filter(s => s.words > 0 && s.words < avg * 0.3)
    .map(s => ({ section: s.name, words: s.words, avg }))
    .slice(0, 3)
}

// Detect missing sections that similar doc types usually have
function findMissingSections(docText: string): string[] {
  const plain = docText.replace(/<[^>]+>/g, '').toLowerCase()
  const headings = new Set(
    (plain.match(/^#{1,3}\s+(.+)/gm) || []).map(h => h.replace(/^#{1,3}\s+/, '').trim())
  )
  const missing: string[] = []

  // PRD patterns
  const isPRD = /\b(product|prd|requirement|feature|user stor)/i.test(plain)
  if (isPRD) {
    if (!hasHeadingLike(headings, ['success metric', 'kpi', 'measure', 'goal'])) missing.push('Success Metrics / KPIs')
    if (!hasHeadingLike(headings, ['risk', 'assumption', 'constraint', 'limitation'])) missing.push('Risks and Assumptions')
    if (!hasHeadingLike(headings, ['timeline', 'milestone', 'schedule', 'phase'])) missing.push('Timeline / Milestones')
    if (!hasHeadingLike(headings, ['scope', 'out of scope', 'non-goal'])) missing.push('Scope / Non-goals')
  }

  // Tech spec patterns
  const isTechSpec = /\b(technical|architecture|system design|api|endpoint|database|schema)/i.test(plain)
  if (isTechSpec) {
    if (!hasHeadingLike(headings, ['error', 'failure', 'edge case', 'exception'])) missing.push('Error Handling / Edge Cases')
    if (!hasHeadingLike(headings, ['security', 'auth', 'permission', 'access'])) missing.push('Security Considerations')
    if (!hasHeadingLike(headings, ['performance', 'scale', 'load', 'latency'])) missing.push('Performance / Scalability')
    if (!hasHeadingLike(headings, ['migration', 'rollback', 'deploy', 'rollout'])) missing.push('Migration / Rollback Plan')
  }

  // Meeting notes patterns
  const isMeeting = /\b(meeting|agenda|attendee|action item|follow.?up|minute)/i.test(plain)
  if (isMeeting) {
    if (!hasHeadingLike(headings, ['action', 'follow-up', 'next step', 'todo'])) missing.push('Action Items / Next Steps')
    if (!hasHeadingLike(headings, ['decision', 'resolved', 'agreed'])) missing.push('Decisions Made')
  }

  return missing.slice(0, 3)
}

function hasHeadingLike(headings: Set<string>, keywords: string[]): boolean {
  for (const h of headings) {
    if (keywords.some(k => h.includes(k))) return true
  }
  return false
}

export function detectObservations(
  docText: string,
  messages: { from: string; text: string }[],
  agentNames: string[],
  phase?: SessionPhase,
): WizardObservation[] {
  const results: WizardObservation[] = []
  const plain = docText.replace(/<[^>]+>/g, '')

  function emit(obs: WizardObservation) {
    const key = `${obs.agent}:${obs.text.slice(0, 40)}`
    if (delivered.has(key)) return
    delivered.add(key)
    results.push(obs)
  }

  const first = agentNames[0]
  const second = agentNames[1] || first

  // During discovery/planning phase, suppress generic greetings — the orchestrator
  // already triggered a focused planning prompt via the LLM
  if (phase === 'discovery' || phase === 'planning') {
    const agentMessages = messages.filter(m => agentNames.includes(m.from))
    const userMessages = messages.filter(m => !agentNames.includes(m.from))
    if (agentMessages.length >= 1 && userMessages.length === 0 && messages.length >= 2) {
      emit({
        agent: second !== first ? second : first,
        type: 'chat',
        text: 'No rush — just let us know what direction you want to take this.',
        delay: 5000,
      })
    }
    return results
  }

  // --- Original detections (preserved) ---

  // Empty doc, few messages — skip during active phase if user already gave direction
  if (plain.trim().length < 30 && messages.length <= 2) {
    if (phase === 'drafting') {
      // no-op: user already directed agents
    } else {
      emit({
        agent: first,
        type: 'chat',
        text: 'Fresh doc. Want me to start, or are you drafting first?',
        delay: 1500,
      })
    }
  }

  // Doc has content but agents haven't spoken much
  if (plain.length > 200 && messages.filter(m => agentNames.includes(m.from)).length < 2) {
    emit({
      agent: first,
      type: 'chat',
      text: 'Good start. I can see the shape — want me to jump into any section?',
      delay: 3000,
    })
  }

  // TODOs in doc
  const todos = plain.match(/\b(TODO|TBD|FIXME)\b/gi)
  if (todos && todos.length > 0) {
    emit({
      agent: second,
      type: 'chat',
      text: `Found ${todos.length} TODO${todos.length > 1 ? 's' : ''} in the doc. Want me to take a crack at ${todos.length > 1 ? 'any of them' : 'it'}?`,
      delay: 2000,
    })
  }

  // Multiple H2s but thin content
  const h2Count = (docText.match(/<h2/gi) || []).length
  if (h2Count >= 3 && plain.length < 400) {
    emit({
      agent: second,
      type: 'chat',
      text: `${h2Count} sections but most are light. Want us to each take one?`,
      delay: 2500,
    })
  }

  // Open questions in the doc
  const questions = plain.split('\n').filter(l => l.trim().endsWith('?'))
  if (questions.length >= 2) {
    emit({
      agent: first,
      type: 'chat',
      text: `There are ${questions.length} open questions. Should we work through them?`,
      delay: 2000,
    })
  }

  // Timeline without risk analysis warning
  const hasTimeline = /\b(Q[1-4]|timeline|phase\s+\d|deadline)\b/i.test(plain)
  const hasRisks = /\b(risk|mitigat|contingenc|fallback|what if)\b/i.test(plain)
  if (hasTimeline && !hasRisks && plain.length > 300) {
    emit({
      agent: second,
      type: 'chat',
      text: 'There\'s a timeline but no risk analysis. What happens if Q2 slips?',
      delay: 3500,
    })
  }

  // Agents not referencing each other's work
  const agentMessages = messages.filter(m => agentNames.includes(m.from))
  const hasCrossRef = agentMessages.some(m => {
    const lower = m.text.toLowerCase()
    return agentNames.some(n => n !== m.from && lower.includes('@' + n.toLowerCase()))
  })
  if (agentMessages.length >= 4 && !hasCrossRef) {
    emit({
      agent: first,
      type: 'chat',
      text: `@${second} have you looked at what I added? Feels like we're working in parallel instead of together.`,
      delay: 4000,
    })
  }

  // --- New detections ---

  // Vague language detection — only fire once doc has substance
  if (plain.length > 300) {
    const vague = findVagueLanguage(plain)
    if (vague.length >= 3) {
      emit({
        agent: second,
        type: 'chat',
        text: `The doc has vague language that should be more specific: "${vague[0]}", "${vague[1]}", "${vague[2]}". Want me to tighten those up with concrete numbers or examples?`,
        delay: 3000,
      })
    }
  }

  // Contradiction detection
  if (plain.length > 400) {
    const contradictions = findContradictions(plain)
    if (contradictions.length > 0) {
      emit({
        agent: first,
        type: 'chat',
        text: `Possible contradiction in the doc: ${contradictions[0]}. We should reconcile this before it causes confusion.`,
        delay: 2500,
      })
    }
  }

  // Disproportionate section detection
  if (plain.length > 400) {
    const thinOnes = findDisproportionateSections(docText)
    if (thinOnes.length > 0) {
      const names = thinOnes.map(t => `"${t.section}" (${t.words} words)`).join(', ')
      emit({
        agent: second,
        type: 'chat',
        text: `${names} ${thinOnes.length === 1 ? 'is' : 'are'} much thinner than the rest of the doc (avg ${thinOnes[0].avg} words/section). ${thinOnes.length === 1 ? 'Should I expand it?' : 'Want us to fill those in?'}`,
        delay: 3000,
      })
    }
  }

  // Missing section detection
  if (plain.length > 300) {
    const missing = findMissingSections(docText)
    if (missing.length > 0) {
      const list = missing.slice(0, 2).join(' and ')
      emit({
        agent: first,
        type: 'chat',
        text: `This doc is missing a ${list} section. Docs like this usually have one — want me to draft it?`,
        delay: 3500,
      })
    }
  }

  // Large doc with no summary or intro
  if (plain.length > 800) {
    const hasIntro = /^[^#\n].{50,}/m.test(plain.slice(0, 300))
    const hasSummary = /\b(summary|overview|tldr|tl;dr|executive summary|abstract)\b/i.test(plain.slice(0, 500))
    if (!hasIntro && !hasSummary) {
      emit({
        agent: first,
        type: 'chat',
        text: 'This doc jumps straight into sections without an overview. Want me to add a 2-3 sentence summary at the top?',
        delay: 3000,
      })
    }
  }

  // Passive voice density check
  if (plain.length > 500) {
    const passiveMatches = plain.match(/\b(?:is|are|was|were|be|been|being)\s+\w+ed\b/gi) || []
    const sentenceCount = plain.split(/[.!?]+/).filter(s => s.trim().length > 10).length
    if (sentenceCount > 5 && passiveMatches.length / sentenceCount > 0.3) {
      emit({
        agent: second,
        type: 'chat',
        text: `Heavy passive voice throughout — about ${Math.round(passiveMatches.length / sentenceCount * 100)}% of sentences. Want me to rewrite the worst offenders in active voice?`,
        delay: 3500,
      })
    }
  }

  return results
}
