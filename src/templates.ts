import type { DocTemplate } from './types'

/** Known placeholder phrases from templates — if the doc still contains these, it hasn't been filled in yet. */
const TEMPLATE_PLACEHOLDERS = [
  'What problem are we solving?',
  'Who has this problem?',
  'What does success look like?',
  'How will we solve it?',
  'As a [user], I want [goal] so that [benefit]',
  'Metric 1: target value',
  'What is being built and why?',
  'System design and component boundaries.',
  'Key entities and relationships.',
  'Endpoints, request/response formats.',
  'Phase 1:',
  'Phase 2:',
]

export type DocState = 'blank' | 'template' | 'sparse' | 'content'

/**
 * Classify the current doc state so the orchestrator can pick the right behavior.
 * - blank: virtually empty (just an h1 title and whitespace)
 * - template: still has template placeholder text the user hasn't replaced
 * - sparse: has some real content but very little (<100 words beyond headings)
 * - content: has substantive content the user or agents have written
 */
export function classifyDocState(docText: string, template?: DocTemplate): DocState {
  const plain = docText.replace(/<[^>]+>/g, '').trim()
  const words = plain.split(/\s+/).filter(Boolean)

  // Blank: less than ~5 real words (covers "Untitled" + whitespace)
  if (words.length < 5) return 'blank'

  // Template: check for placeholder phrases
  if (template && template !== 'blank') {
    const matchCount = TEMPLATE_PLACEHOLDERS.filter(p => plain.includes(p)).length
    if (matchCount >= 2) return 'template'
  }

  // Sparse: some content but under 100 words of body text
  if (words.length < 100) return 'sparse'

  return 'content'
}

export const DOC_TEMPLATES: Record<DocTemplate, { label: string, content: string }> = {
  blank: {
    label: 'Blank',
    content: '<h1>Untitled</h1><p></p>',
  },
  prd: {
    label: 'PRD',
    content: `<h1>Product Requirements Document</h1>
<h2>Problem</h2>
<p>What problem are we solving? Who has this problem?</p>
<h2>Goal</h2>
<p>What does success look like?</p>
<h2>Proposed Solution</h2>
<p>How will we solve it?</p>
<h2>User Stories</h2>
<ul><li>As a [user], I want [goal] so that [benefit]</li></ul>
<h2>Success Metrics</h2>
<ul><li>Metric 1: target value</li></ul>
<h2>Open Questions</h2>
<ul><li></li></ul>`,
  },
  'tech-spec': {
    label: 'Tech Spec',
    content: `<h1>Technical Specification</h1>
<h2>Overview</h2>
<p>What is being built and why?</p>
<h2>Architecture</h2>
<p>System design and component boundaries.</p>
<h2>Data Model</h2>
<p>Key entities and relationships.</p>
<h2>API Design</h2>
<p>Endpoints, request/response formats.</p>
<h2>Implementation Plan</h2>
<ul><li>Phase 1:</li><li>Phase 2:</li></ul>
<h2>Risks and Mitigations</h2>
<ul><li></li></ul>`,
  },
  'demo-prd': {
    label: 'Demo PRD',
    content: `<h1>TaskFlow — Product Brief</h1>
<h2>Problem</h2>
<p>Users are unhappy with the current experience. We have heard some complaints and think there is an opportunity to do better.</p>
<h2>Proposed Solution</h2>
<p>Rebuild the platform using a microservices architecture. Each feature will be its own service, communicating over REST APIs. We will use Kubernetes for orchestration and deploy to three cloud regions for redundancy.</p>
<h2>Success Metrics</h2>
<ul>
<li>Users love the new product</li>
<li>Engagement goes up</li>
<li>Fewer complaints</li>
</ul>
<h2>Architecture</h2>
<p>We will split the monolith into 12 microservices. Each team owns one service. Communication happens via REST and an event bus. We chose microservices because they are the industry standard.</p>
<h2>Timeline</h2>
<ul>
<li>Q1: Design phase</li>
<li>Q2: Build core services</li>
<li>Q3: Migration</li>
<li>Q4: Launch</li>
</ul>`,
  },
  'meeting-notes': {
    label: 'Meeting Notes',
    content: `<h1>Meeting Notes</h1>
<h2>Attendees</h2>
<ul><li></li></ul>
<h2>Agenda</h2>
<ul><li></li></ul>
<h2>Discussion</h2>
<p></p>
<h2>Decisions</h2>
<ul><li></li></ul>
<h2>Action Items</h2>
<ul><li></li></ul>`,
  },
}
