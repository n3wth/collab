import { describe, it, expect } from 'vitest'
import { AGENT_MODES, getAgentMode } from '../agent-modes'
import { PHASE_ORDER } from '../phase-machine'

describe('agent-modes', () => {
  const EXPECTED_AGENTS = ['Aiden', 'Nova', 'Lex', 'Mira']

  describe('AGENT_MODES', () => {
    it('has modes for all four preset agents', () => {
      for (const agent of EXPECTED_AGENTS) {
        expect(AGENT_MODES[agent]).toBeDefined()
      }
    })

    it('has a mode for each phase per agent', () => {
      for (const agent of EXPECTED_AGENTS) {
        for (const phase of PHASE_ORDER) {
          const mode = AGENT_MODES[agent][phase]
          expect(mode).toBeDefined()
          expect(mode.label).toBeTruthy()
          expect(mode.promptModifier).toBeTruthy()
          expect(Array.isArray(mode.allowedActions)).toBe(true)
          expect(mode.allowedActions.length).toBeGreaterThan(0)
        }
      }
    })

    it('discovery modes only allow non-editing actions', () => {
      for (const agent of EXPECTED_AGENTS) {
        const mode = AGENT_MODES[agent].discovery
        expect(mode.allowedActions).not.toContain('insert')
        expect(mode.allowedActions).not.toContain('replace')
        expect(mode.allowedActions).not.toContain('delete')
      }
    })

    it('review modes do not allow insert', () => {
      for (const agent of EXPECTED_AGENTS) {
        const mode = AGENT_MODES[agent].review
        expect(mode.allowedActions).not.toContain('insert')
      }
    })

    it('drafting modes allow editing actions', () => {
      // At least Aiden in drafting should be able to insert
      const mode = AGENT_MODES.Aiden.drafting
      expect(mode.allowedActions).toContain('insert')
      expect(mode.allowedActions).toContain('replace')
    })
  })

  describe('getAgentMode', () => {
    it('returns the mode for a known agent and phase', () => {
      const mode = getAgentMode('Aiden', 'discovery')
      expect(mode.label).toBeTruthy()
      expect(mode.promptModifier).toBeTruthy()
    })

    it('returns a default mode for unknown agents', () => {
      const mode = getAgentMode('UnknownAgent', 'drafting')
      expect(mode.label).toBeTruthy()
      expect(mode.allowedActions.length).toBeGreaterThan(0)
    })

    it('mode labels are unique per agent across phases', () => {
      for (const agent of EXPECTED_AGENTS) {
        const labels = PHASE_ORDER.map(p => AGENT_MODES[agent][p].label)
        const unique = new Set(labels)
        expect(unique.size).toBe(labels.length)
      }
    })
  })
})
