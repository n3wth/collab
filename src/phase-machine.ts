export type SessionPhase = 'discovery' | 'planning' | 'drafting' | 'review'

export const PHASE_ORDER: SessionPhase[] = ['discovery', 'planning', 'drafting', 'review']

export interface PhaseConfig {
  label: string
  description: string
  allowedActionTypes: Set<string>
}

export const PHASE_CONFIGS: Record<SessionPhase, PhaseConfig> = {
  discovery: {
    label: 'Discovery',
    description: 'Understand the problem. Ask questions, explore scope.',
    allowedActionTypes: new Set(['chat', 'ask', 'search']),
  },
  planning: {
    label: 'Planning',
    description: 'Define structure and approach. Outline, propose, plan.',
    allowedActionTypes: new Set(['chat', 'ask', 'plan', 'search', 'propose']),
  },
  drafting: {
    label: 'Drafting',
    description: 'Write the document. All actions available.',
    allowedActionTypes: new Set(['insert', 'replace', 'read', 'chat', 'search', 'delete', 'rename', 'propose', 'plan', 'ask', 'image']),
  },
  review: {
    label: 'Review',
    description: 'Critique and refine. Read, suggest edits, discuss.',
    allowedActionTypes: new Set(['read', 'chat', 'replace', 'search', 'ask']),
  },
}

export interface PhaseState {
  current: SessionPhase
  history: SessionPhase[]
  transitionSuggested: boolean
  suggestedNext: SessionPhase | null
}

export const initialPhaseState: PhaseState = {
  current: 'discovery',
  history: [],
  transitionSuggested: false,
  suggestedNext: null,
}

export type PhaseAction =
  | { type: 'advance' }
  | { type: 'go-back' }
  | { type: 'jump-to'; phase: SessionPhase }
  | { type: 'suggest-transition'; next: SessionPhase }
  | { type: 'dismiss-suggestion' }

export function phaseReducer(state: PhaseState, action: PhaseAction): PhaseState {
  switch (action.type) {
    case 'advance': {
      const idx = PHASE_ORDER.indexOf(state.current)
      if (idx >= PHASE_ORDER.length - 1) return state
      return {
        current: PHASE_ORDER[idx + 1],
        history: [...state.history, state.current],
        transitionSuggested: false,
        suggestedNext: null,
      }
    }
    case 'go-back': {
      if (state.history.length === 0) return state
      const prev = state.history[state.history.length - 1]
      return {
        current: prev,
        history: state.history.slice(0, -1),
        transitionSuggested: false,
        suggestedNext: null,
      }
    }
    case 'jump-to': {
      if (action.phase === state.current) return state
      return {
        current: action.phase,
        history: [...state.history, state.current],
        transitionSuggested: false,
        suggestedNext: null,
      }
    }
    case 'suggest-transition': {
      return {
        ...state,
        transitionSuggested: true,
        suggestedNext: action.next,
      }
    }
    case 'dismiss-suggestion': {
      return {
        ...state,
        transitionSuggested: false,
        suggestedNext: null,
      }
    }
  }
}

export function isActionAllowed(phase: SessionPhase, actionType: string): boolean {
  return PHASE_CONFIGS[phase].allowedActionTypes.has(actionType)
}
