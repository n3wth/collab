import { describe, it, expect } from 'vitest'
import {
  phaseReducer,
  initialPhaseState,
  PHASE_ORDER,
  PHASE_CONFIGS,
  type PhaseState,
} from '../phase-machine'

describe('phase-machine', () => {
  describe('PHASE_ORDER', () => {
    it('has four phases in correct order', () => {
      expect(PHASE_ORDER).toEqual(['discovery', 'planning', 'drafting', 'review'])
    })
  })

  describe('PHASE_CONFIGS', () => {
    it('has config for each phase', () => {
      for (const phase of PHASE_ORDER) {
        expect(PHASE_CONFIGS[phase]).toBeDefined()
        expect(PHASE_CONFIGS[phase].label).toBeTruthy()
        expect(PHASE_CONFIGS[phase].allowedActionTypes).toBeInstanceOf(Set)
      }
    })

    it('discovery only allows chat, ask, search', () => {
      const allowed = PHASE_CONFIGS.discovery.allowedActionTypes
      expect(allowed.has('chat')).toBe(true)
      expect(allowed.has('ask')).toBe(true)
      expect(allowed.has('search')).toBe(true)
      expect(allowed.has('insert')).toBe(false)
      expect(allowed.has('replace')).toBe(false)
    })

    it('planning allows chat, ask, plan, search, propose but not insert', () => {
      const allowed = PHASE_CONFIGS.planning.allowedActionTypes
      expect(allowed.has('chat')).toBe(true)
      expect(allowed.has('plan')).toBe(true)
      expect(allowed.has('propose')).toBe(true)
      expect(allowed.has('insert')).toBe(false)
    })

    it('drafting allows all action types', () => {
      const allowed = PHASE_CONFIGS.drafting.allowedActionTypes
      expect(allowed.has('insert')).toBe(true)
      expect(allowed.has('replace')).toBe(true)
      expect(allowed.has('chat')).toBe(true)
      expect(allowed.has('search')).toBe(true)
    })

    it('review allows read, chat, replace, search but not insert', () => {
      const allowed = PHASE_CONFIGS.review.allowedActionTypes
      expect(allowed.has('read')).toBe(true)
      expect(allowed.has('chat')).toBe(true)
      expect(allowed.has('replace')).toBe(true)
      expect(allowed.has('search')).toBe(true)
      expect(allowed.has('insert')).toBe(false)
    })
  })

  describe('initialPhaseState', () => {
    it('starts in discovery phase', () => {
      expect(initialPhaseState.current).toBe('discovery')
      expect(initialPhaseState.history).toEqual([])
      expect(initialPhaseState.transitionSuggested).toBe(false)
      expect(initialPhaseState.suggestedNext).toBeNull()
    })
  })

  describe('phaseReducer', () => {
    describe('advance', () => {
      it('advances from discovery to planning', () => {
        const state = phaseReducer(initialPhaseState, { type: 'advance' })
        expect(state.current).toBe('planning')
        expect(state.history).toEqual(['discovery'])
      })

      it('advances from planning to drafting', () => {
        const state: PhaseState = { current: 'planning', history: ['discovery'], transitionSuggested: false, suggestedNext: null }
        const next = phaseReducer(state, { type: 'advance' })
        expect(next.current).toBe('drafting')
        expect(next.history).toEqual(['discovery', 'planning'])
      })

      it('advances from drafting to review', () => {
        const state: PhaseState = { current: 'drafting', history: ['discovery', 'planning'], transitionSuggested: false, suggestedNext: null }
        const next = phaseReducer(state, { type: 'advance' })
        expect(next.current).toBe('review')
      })

      it('does not advance past review', () => {
        const state: PhaseState = { current: 'review', history: ['discovery', 'planning', 'drafting'], transitionSuggested: false, suggestedNext: null }
        const next = phaseReducer(state, { type: 'advance' })
        expect(next.current).toBe('review')
      })

      it('clears suggestion on advance', () => {
        const state: PhaseState = { current: 'discovery', history: [], transitionSuggested: true, suggestedNext: 'planning' }
        const next = phaseReducer(state, { type: 'advance' })
        expect(next.transitionSuggested).toBe(false)
        expect(next.suggestedNext).toBeNull()
      })
    })

    describe('go-back', () => {
      it('goes back to previous phase from history', () => {
        const state: PhaseState = { current: 'drafting', history: ['discovery', 'planning'], transitionSuggested: false, suggestedNext: null }
        const next = phaseReducer(state, { type: 'go-back' })
        expect(next.current).toBe('planning')
        expect(next.history).toEqual(['discovery'])
      })

      it('does not go back from discovery', () => {
        const next = phaseReducer(initialPhaseState, { type: 'go-back' })
        expect(next.current).toBe('discovery')
        expect(next.history).toEqual([])
      })
    })

    describe('jump-to', () => {
      it('jumps to a specific phase', () => {
        const next = phaseReducer(initialPhaseState, { type: 'jump-to', phase: 'drafting' })
        expect(next.current).toBe('drafting')
        expect(next.history).toEqual(['discovery'])
      })

      it('does not change if jumping to current phase', () => {
        const next = phaseReducer(initialPhaseState, { type: 'jump-to', phase: 'discovery' })
        expect(next.current).toBe('discovery')
        expect(next.history).toEqual([])
      })
    })

    describe('suggest-transition', () => {
      it('sets suggestion', () => {
        const next = phaseReducer(initialPhaseState, { type: 'suggest-transition', next: 'planning' })
        expect(next.transitionSuggested).toBe(true)
        expect(next.suggestedNext).toBe('planning')
        expect(next.current).toBe('discovery') // does not change phase
      })
    })

    describe('dismiss-suggestion', () => {
      it('clears suggestion', () => {
        const state: PhaseState = { current: 'discovery', history: [], transitionSuggested: true, suggestedNext: 'planning' }
        const next = phaseReducer(state, { type: 'dismiss-suggestion' })
        expect(next.transitionSuggested).toBe(false)
        expect(next.suggestedNext).toBeNull()
      })
    })
  })

  describe('isActionAllowed', () => {
    // Import this helper once it exists
    it('returns true for allowed actions in current phase', async () => {
      const { isActionAllowed } = await import('../phase-machine')
      expect(isActionAllowed('discovery', 'chat')).toBe(true)
      expect(isActionAllowed('discovery', 'insert')).toBe(false)
      expect(isActionAllowed('drafting', 'insert')).toBe(true)
      expect(isActionAllowed('review', 'insert')).toBe(false)
      expect(isActionAllowed('review', 'replace')).toBe(true)
    })
  })
})
