/**
 * Prompt-native heartbeat — proactive agent observations.
 * Uses a single LLM call instead of hardcoded pattern matchers.
 * The agent prompt defines what to look for, not code.
 */

import { askAgent, type AskParams } from './agent'

const delivered = new Set<string>()

export function resetHeartbeat(): void {
  delivered.clear()
}

export async function generateObservation(
  docText: string,
  recentMessages: { from: string; text: string }[],
  agentName: string,
  persona: string,
  otherAgents: string[],
): Promise<string | null> {
  // Skip if doc is empty
  if (!docText || docText.replace(/<[^>]+>/g, '').trim().length < 50) return null

  // 30% skip rate to keep it natural
  if (Math.random() < 0.3) return null

  const params: AskParams = {
    agentName,
    ownerName: agentName,
    docText,
    chatHistory: recentMessages,
    trigger: 'autonomous' as const,
    persona,
    otherAgents,
  }

  try {
    const action = await askAgent(params)
    const observation = action.chatMessage || action.chatBefore || null

    if (observation) {
      // Dedup: don't repeat similar observations
      const key = `${agentName}:${observation.slice(0, 40)}`
      if (delivered.has(key)) return null
      delivered.add(key)
    }

    return observation
  } catch {
    return null
  }
}

// Backward-compatible export for existing code that calls generateHeartbeat
export function generateHeartbeat(
  _docText: string,
  _recentMessages: { from: string; text: string }[],
): string | null {
  // Legacy sync function — returns null, real observations come via generateObservation
  return null
}
