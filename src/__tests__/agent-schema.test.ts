import { describe, it, expect } from 'vitest'
import { agentActionSchema } from '../agent-schema'

describe('agentActionSchema', () => {
  describe('valid actions', () => {
    it('parses a chat action', () => {
      const result = agentActionSchema.safeParse({
        type: 'chat',
        reasoning: ['noticed gap', 'will comment'],
        chatMessage: 'This section needs more detail.',
        shouldContinue: false,
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('chat')
        expect(result.data.chatMessage).toBe('This section needs more detail.')
      }
    })

    it('parses an insert action', () => {
      const result = agentActionSchema.safeParse({
        type: 'insert',
        reasoning: ['section empty', 'adding content'],
        position: 'after:Introduction',
        content: 'New paragraph here.',
        thought: 'Adding intro',
        chatBefore: 'Adding an intro paragraph',
        shouldContinue: false,
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('insert')
        expect(result.data.content).toBe('New paragraph here.')
        expect(result.data.position).toBe('after:Introduction')
      }
    })

    it('parses a replace action', () => {
      const result = agentActionSchema.safeParse({
        type: 'replace',
        reasoning: ['vague text', 'making specific'],
        searchText: 'various improvements',
        replaceWith: 'latency drops from 200ms to 40ms',
        thought: 'Fixing vague',
        chatBefore: 'Making this more specific',
        shouldContinue: false,
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('replace')
        expect(result.data.searchText).toBe('various improvements')
      }
    })

    it('parses a search action', () => {
      const result = agentActionSchema.safeParse({
        type: 'search',
        reasoning: ['need data', 'searching'],
        query: 'market size for AI writing tools 2025',
        thought: 'Researching market',
        shouldContinue: true,
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('search')
        expect(result.data.shouldContinue).toBe(true)
      }
    })

    it('parses a read action', () => {
      const result = agentActionSchema.safeParse({
        type: 'read',
        reasoning: ['reviewing section'],
        highlightText: 'The system processes requests',
        thought: 'Reading intro',
        shouldContinue: false,
      })
      expect(result.success).toBe(true)
    })

    it('parses a rename action', () => {
      const result = agentActionSchema.safeParse({
        type: 'rename',
        reasoning: ['title mismatch'],
        newTitle: 'Mobile App PRD',
        chatMessage: 'Renamed to match content',
      })
      expect(result.success).toBe(true)
    })

    it('parses a delete action', () => {
      const result = agentActionSchema.safeParse({
        type: 'delete',
        reasoning: ['redundant text'],
        deleteText: 'This section covers the overview.',
        chatBefore: 'Removing filler sentence',
      })
      expect(result.success).toBe(true)
    })

    it('parses a propose action', () => {
      const result = agentActionSchema.safeParse({
        type: 'propose',
        reasoning: ['need legal review'],
        proposalType: 'add-agent',
        proposal: 'Add Lex for compliance review',
        chatMessage: 'Should we bring in Lex?',
      })
      expect(result.success).toBe(true)
    })

    it('parses a plan action', () => {
      const result = agentActionSchema.safeParse({
        type: 'plan',
        reasoning: ['multiple changes needed'],
        steps: ['Step 1: Fix intro', 'Step 2: Add metrics'],
        chatMessage: 'Here is my plan',
        shouldContinue: true,
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.steps).toHaveLength(2)
      }
    })

    it('parses an ask action', () => {
      const result = agentActionSchema.safeParse({
        type: 'ask',
        reasoning: ['unclear scope'],
        question: 'What is the target audience?',
        chatMessage: 'Need to understand the audience first',
      })
      expect(result.success).toBe(true)
    })

    it('parses an image action', () => {
      const result = agentActionSchema.safeParse({
        type: 'image',
        reasoning: ['diagram needed'],
        imagePrompt: 'Architecture diagram showing API gateway and microservices',
        imageCaption: 'System Architecture',
        position: 'after:Architecture',
        chatBefore: 'Generating architecture diagram',
        shouldContinue: false,
      })
      expect(result.success).toBe(true)
    })
  })

  describe('optional fields', () => {
    it('allows missing optional fields', () => {
      const result = agentActionSchema.safeParse({
        type: 'chat',
        chatMessage: 'hello',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.reasoning).toBeUndefined()
        expect(result.data.shouldContinue).toBeUndefined()
      }
    })
  })

  describe('invalid actions', () => {
    it('rejects unknown action type', () => {
      const result = agentActionSchema.safeParse({
        type: 'explode',
        chatMessage: 'boom',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing type', () => {
      const result = agentActionSchema.safeParse({
        chatMessage: 'hello',
      })
      expect(result.success).toBe(false)
    })
  })
})
