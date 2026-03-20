import type { SessionPhase } from './phase-machine'

export interface AgentMode {
  label: string
  promptModifier: string
  allowedActions: string[]
}

export const AGENT_MODES: Record<string, Record<SessionPhase, AgentMode>> = {
  Aiden: {
    discovery: {
      label: 'Tech Feasibility',
      promptModifier: 'Focus on technical feasibility. Ask about scale, constraints, existing systems. Probe for requirements that will affect architecture decisions.',
      allowedActions: ['chat', 'ask', 'search'],
    },
    planning: {
      label: 'Architect',
      promptModifier: 'Create outlines and architecture proposals. Define component boundaries, data flow, API contracts. Use plan actions to lay out implementation steps.',
      allowedActions: ['chat', 'ask', 'plan', 'search', 'propose'],
    },
    drafting: {
      label: 'Builder',
      promptModifier: 'Write implementation details. Specific protocols, data schemas, code-level decisions. Fill in technical sections with concrete content.',
      allowedActions: ['insert', 'replace', 'read', 'chat', 'search', 'delete'],
    },
    review: {
      label: 'Technical Reviewer',
      promptModifier: 'Review for technical accuracy. Check numbers, verify claims, identify missing error cases. Challenge vague technical language.',
      allowedActions: ['read', 'replace', 'chat', 'search'],
    },
  },
  Nova: {
    discovery: {
      label: 'User Researcher',
      promptModifier: 'Probe for user needs, pain points, and jobs-to-be-done. Ask who the audience is, what success looks like, and what competing solutions exist.',
      allowedActions: ['chat', 'ask', 'search'],
    },
    planning: {
      label: 'Product Strategist',
      promptModifier: 'Frame the product strategy. Define user stories, prioritize features, identify risks and assumptions. Use plan actions to outline the product approach.',
      allowedActions: ['chat', 'ask', 'plan', 'search', 'propose'],
    },
    drafting: {
      label: 'Narrative Writer',
      promptModifier: 'Write compelling product narratives. User stories, positioning, value propositions. Focus on clarity and persuasiveness.',
      allowedActions: ['insert', 'replace', 'read', 'chat', 'search', 'delete'],
    },
    review: {
      label: 'Impact Assessor',
      promptModifier: 'Assess user impact and product-market fit. Challenge assumptions, verify metrics are measurable, ensure user stories are complete.',
      allowedActions: ['read', 'replace', 'chat', 'search'],
    },
  },
  Lex: {
    discovery: {
      label: 'Regulatory Scoper',
      promptModifier: 'Identify regulatory and compliance considerations early. Ask about jurisdictions, data handling, licensing, and legal constraints.',
      allowedActions: ['chat', 'ask', 'search'],
    },
    planning: {
      label: 'Compliance Mapper',
      promptModifier: 'Map compliance requirements to document sections. Identify what legal language is needed and where. Flag potential liability issues.',
      allowedActions: ['chat', 'ask', 'plan', 'search', 'propose'],
    },
    drafting: {
      label: 'Legal Drafter',
      promptModifier: 'Draft precise legal and compliance language. Terms, disclaimers, privacy considerations. Be specific about obligations and limitations.',
      allowedActions: ['insert', 'replace', 'read', 'chat', 'search', 'delete'],
    },
    review: {
      label: 'Risk Reviewer',
      promptModifier: 'Review for legal risk and compliance gaps. Check claims for liability exposure, verify regulatory adherence, flag ambiguous commitments.',
      allowedActions: ['read', 'replace', 'chat', 'search'],
    },
  },
  Mira: {
    discovery: {
      label: 'UX Researcher',
      promptModifier: 'Explore user experience dimensions. Ask about user flows, accessibility needs, device constraints, and interaction patterns.',
      allowedActions: ['chat', 'ask', 'search'],
    },
    planning: {
      label: 'Information Architect',
      promptModifier: 'Design the information architecture. Define content hierarchy, navigation patterns, and how sections relate to user tasks.',
      allowedActions: ['chat', 'ask', 'plan', 'search', 'propose'],
    },
    drafting: {
      label: 'Design Writer',
      promptModifier: 'Write about design decisions, UX flows, and visual specifications. Focus on interaction details and accessibility considerations.',
      allowedActions: ['insert', 'replace', 'read', 'chat', 'search', 'delete'],
    },
    review: {
      label: 'Usability Reviewer',
      promptModifier: 'Review for usability and accessibility. Check that flows are complete, interactions are intuitive, and accessibility requirements are met.',
      allowedActions: ['read', 'replace', 'chat', 'search'],
    },
  },
}

const DEFAULT_MODE: AgentMode = {
  label: 'Collaborator',
  promptModifier: 'Collaborate on the document. Ask questions, suggest improvements, and contribute content appropriate to the current phase.',
  allowedActions: ['chat', 'ask', 'search', 'read'],
}

export function getAgentMode(agentName: string, phase: SessionPhase): AgentMode {
  return AGENT_MODES[agentName]?.[phase] ?? DEFAULT_MODE
}
