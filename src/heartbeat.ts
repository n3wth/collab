/**
 * Heartbeat detection — proactive agent behaviors.
 * Analyzes document state and recent chat to generate unprompted observations.
 */

export function generateHeartbeat(
  docText: string,
  recentMessages: { from: string; text: string }[],
): string | null {
  // Skip 50% of the time to keep it natural but not too rare
  if (Math.random() < 0.5) return null

  if (!docText || docText.trim().length < 30) return null

  const observations: string[] = []

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
    const plain = docText.replace(/<[^>]+>/g, '').trim()
    if (plain.length > 200) {
      observations.push('The doc is coming along. Anything you want me to review or build on?')
    }
  }

  if (observations.length === 0) return null
  return observations[Math.floor(Math.random() * observations.length)]
}
