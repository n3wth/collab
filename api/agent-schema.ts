import { z } from 'zod'

export const agentActionSchema = z.object({
  type: z.enum([
    'insert', 'replace', 'read', 'chat', 'search',
    'rename', 'delete', 'propose', 'plan', 'ask', 'image',
  ]),
  // Positioning and content
  position: z.string().optional(),
  content: z.string().optional(),
  searchText: z.string().optional(),
  replaceWith: z.string().optional(),
  highlightText: z.string().optional(),
  query: z.string().optional(),
  newTitle: z.string().optional(),
  deleteText: z.string().optional(),
  proposal: z.string().optional(),
  proposalType: z.enum(['create-doc', 'delete-doc', 'add-agent', 'remove-agent']).optional(),
  steps: z.array(z.string()).optional(),
  question: z.string().optional(),
  imagePrompt: z.string().optional(),
  imageCaption: z.string().optional(),
  // Chat and reasoning
  chatBefore: z.string().optional(),
  chatMessage: z.string().optional(),
  thought: z.string().optional(),
  reasoning: z.array(z.string()).optional(),
  shouldContinue: z.boolean().optional(),
})

export type AgentActionFromSchema = z.infer<typeof agentActionSchema>
