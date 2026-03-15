/**
 * Wizard of Oz — scripted proactive agent behaviors.
 * Detects doc/chat patterns and surfaces observations without LLM calls.
 */

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

export function detectObservations(
  docText: string,
  messages: { from: string; text: string }[],
  agentNames: string[],
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

  // Empty doc, few messages — first-timer greeting
  if (plain.trim().length < 30 && messages.length <= 2) {
    emit({
      agent: first,
      type: 'chat',
      text: 'Fresh doc. Want me to start, or are you drafting first?',
      delay: 1500,
    })
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
      text: `@${second} have you looked at what I added? Feels like we\'re working in parallel instead of together.`,
      delay: 4000,
    })
  }

  return results
}
