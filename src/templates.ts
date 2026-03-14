import type { DocTemplate } from './types'

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
