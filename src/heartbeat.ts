/**
 * Heartbeat detection — proactive agent behaviors.
 * Analyzes document state and recent chat to generate unprompted observations.
 */

export function generateHeartbeat(
  docText: string,
  recentMessages: { from: string; text: string }[],
): string | null {
  // Skip 30% of the time to keep it natural
  if (Math.random() < 0.3) return null

  if (!docText || docText.trim().length < 30) return null

  const observations: string[] = []
  const plain = docText.replace(/<[^>]+>/g, '').trim()

  // Pattern 1: Empty placeholders
  if (/<li>\s*<\/li>/.test(docText) || /<p>\s*<\/p>/.test(docText)) {
    observations.push('I noticed some empty sections in the doc. Want me to fill those in?')
  }
  if (/\b(TBD|TODO|FIXME)\b/i.test(docText)) {
    observations.push('There are TODO/TBD placeholders in the doc — want me to take a crack at those?')
  }

  // Pattern 2: Open questions in headings or bullets
  const headingQs = docText.match(/<h[1-6][^>]*>[^<]*\?[^<]*<\/h[1-6]>/gi)
  if (headingQs && headingQs.length > 0) {
    const q = headingQs[0].replace(/<[^>]+>/g, '').trim()
    observations.push(`The doc has an open question: "${q}" — want to talk through that?`)
  }
  const listQs = docText.match(/<li[^>]*>[^<]*\?[^<]*<\/li>/gi)
  if (listQs && listQs.length > 1) {
    observations.push(`There are ${listQs.length} open questions in the doc. Should we work through them?`)
  }

  // Pattern 3: Thin sections (heading with < 40 chars of body)
  const sections = docText.split(/<h[1-6][^>]*>/i)
  for (let i = 1; i < sections.length; i++) {
    const content = sections[i].replace(/<[^>]+>/g, '').trim()
    const heading = content.match(/^([^\n]+)/)
    if (heading) {
      const body = content.slice(heading[1].length).trim()
      if (body.length > 0 && body.length < 40) {
        observations.push(`The "${heading[1].trim()}" section looks thin. Want me to expand it?`)
        break
      }
    }
  }

  // Pattern 4: Quiet chat but doc has content
  if (recentMessages.length <= 3) {
    if (plain.length > 200) {
      observations.push('The doc is coming along. Anything you want me to review or build on?')
    }
  }

  // Pattern 5: Inconsistency detection — timeline vs scope conflicts
  const hasTimeline = /\b(Q[1-4]|timeline|deadline|by\s+(January|February|March|April|May|June|July|August|September|October|November|December))\b/i.test(plain)
  const hasMicroservices = /\b(microservices?|12\s+services?|split.*monolith)\b/i.test(plain)
  if (hasTimeline && hasMicroservices && plain.length > 300) {
    observations.push('The timeline and scope might conflict — migrating to microservices in one quarter is aggressive. Worth flagging?')
  }

  // Pattern 6: Missing stakeholder detection
  const hasUsers = /\b(users?|customers?|clients?)\b/i.test(plain)
  const hasStakeholder = /\b(stakeholder|PM|product\s+manager|engineering\s+lead|design)\b/i.test(plain)
  if (plain.length > 300 && !hasStakeholder && hasUsers) {
    observations.push('The doc mentions users but no internal stakeholders. Who owns this on the team?')
  }

  // Pattern 7: Buzzword density check
  const buzzwords = plain.match(/\b(leverage|synergy|paradigm|disrupt|ecosystem|scalable|robust|seamless|cutting-edge|best-in-class|world-class|industry-leading)\b/gi)
  if (buzzwords && buzzwords.length >= 3) {
    observations.push(`Found ${buzzwords.length} buzzwords without substance behind them. Want me to replace them with specifics?`)
  }

  // Pattern 8: Quantification gap detection
  const vaguePerf = /\b(improve|increase|reduce|better|faster|more efficient)\s+(performance|speed|quality|reliability|engagement)\b/i.test(plain)
  const hasNumbers = /\b\d+(\.\d+)?\s*(%|ms|seconds?|minutes?|x\b|times)\b/i.test(plain)
  if (vaguePerf && !hasNumbers && plain.length > 200) {
    observations.push('The doc claims improvements without numbers. "Faster" means nothing without a baseline and target.')
  }

  // Pattern 9: Claims without backing data — trigger search
  const marketClaims = /\b(the market is|market size|TAM|growing\s+(rapidly|fast|quickly))\b/i.test(plain)
  const hasSource = /\b(source|according to|study|research|report|data from)\b/i.test(plain)
  if (marketClaims && !hasSource) {
    observations.push('There are market claims without sources. Want me to search for current data to back these up?')
  }

  // Pattern 10: Competitor mentions without analysis
  const competitorMention = /\b(competitors?|competitive|vs\.?|compared to|alternative)\b/i.test(plain)
  const hasAnalysis = /\b(advantage|differentiat|weakness|strength|gap|positioning)\b/i.test(plain)
  if (competitorMention && !hasAnalysis && plain.length > 200) {
    observations.push('Competitors are mentioned but not analyzed. Want me to search for a competitive landscape overview?')
  }

  if (observations.length === 0) return null
  return observations[Math.floor(Math.random() * observations.length)]
}
