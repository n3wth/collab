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

  return results
}
