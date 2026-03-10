import type { Editor } from '@tiptap/react'
import type { AgentAction } from './agent'

const AGENTS: Record<string, { color: string, bgColor: string }> = {
  Aiden: { color: '#1a73e8', bgColor: '#e8f0fe' },
  Nova: { color: '#e37400', bgColor: '#fef7e0' },
}

export interface ActionCallbacks {
  onStateChange: (status: 'idle' | 'thinking' | 'typing' | 'reading' | 'editing', thought?: string) => void
  onChatMessage: (from: string, text: string) => void
  onDone: (success?: boolean) => void
}

// Convert markdown-ish content to standalone HTML blocks for sequential insertion
function contentToBlocks(content: string): string[] {
  const cleaned = content
    .replace(/^#{3,}\s+/gm, '## ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
  const lines = cleaned.split('\n').filter(l => l.trim() !== '')
  const blocks: string[] = []
  let topItems: { text: string, subItems: string[] }[] = []

  const flushList = () => {
    if (topItems.length > 0) {
      const html = topItems.map(item => {
        if (item.subItems.length > 0) {
          return `<li>${item.text}<ul>${item.subItems.map(s => `<li>${s}</li>`).join('')}</ul></li>`
        }
        return `<li>${item.text}</li>`
      }).join('')
      blocks.push(`<ul>${html}</ul>`)
      topItems = []
    }
  }

  for (const line of lines) {
    if (/^[\t ]{2,}- /.test(line)) {
      const text = line.replace(/^[\t ]*- /, '')
      if (topItems.length > 0) {
        topItems[topItems.length - 1].subItems.push(text)
      } else {
        topItems.push({ text, subItems: [] })
      }
    } else if (line.startsWith('- ')) {
      topItems.push({ text: line.slice(2), subItems: [] })
    } else {
      flushList()
      if (line.startsWith('### ')) blocks.push(`<h3>${line.slice(4)}</h3>`)
      else if (line.startsWith('## ')) blocks.push(`<h2>${line.slice(3)}</h2>`)
      else if (line.startsWith('# ')) blocks.push(`<h1>${line.slice(2)}</h1>`)
      else blocks.push(`<p>${line}</p>`)
    }
  }
  flushList()
  return blocks
}

// Find position of text in the document (works across text node boundaries)
function findTextPos(editor: Editor, searchText: string): { from: number, to: number } | null {
  const doc = editor.state.doc
  const searchLower = searchText.toLowerCase()

  const textChunks: { text: string, pos: number }[] = []
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      textChunks.push({ text: node.text, pos })
    }
  })

  let fullText = ''
  const posMap: number[] = []
  for (const chunk of textChunks) {
    for (let i = 0; i < chunk.text.length; i++) {
      posMap.push(chunk.pos + i)
      fullText += chunk.text[i]
    }
  }

  const idx = fullText.toLowerCase().indexOf(searchLower)
  if (idx >= 0 && idx + searchText.length - 1 < posMap.length) {
    return { from: posMap[idx], to: posMap[idx + searchText.length - 1] + 1 }
  }

  // Fallback: try matching first 30 chars
  if (searchLower.length > 30) {
    const partial = searchLower.slice(0, 30)
    const pidx = fullText.toLowerCase().indexOf(partial)
    if (pidx >= 0) {
      const endIdx = Math.min(pidx + searchText.length, fullText.length)
      return { from: posMap[pidx], to: posMap[Math.min(endIdx - 1, posMap.length - 1)] + 1 }
    }
  }

  return null
}

// Get all existing heading texts from the editor
function getExistingHeadings(editor: Editor): Set<string> {
  const headings = new Set<string>()
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'heading') {
      headings.add(node.textContent.trim().toLowerCase())
    }
  })
  return headings
}

// Clamp position to valid document range
function clampPos(editor: Editor, pos: number): number {
  return Math.max(0, Math.min(pos, editor.state.doc.content.size))
}

// Safe cursor helpers — catch mismatched transaction errors
function safeCursor(editor: Editor, opts: { name: string, color: string, pos: number, selectionFrom?: number, selectionTo?: number, thought?: string }) {
  try {
    const clamped = {
      ...opts,
      pos: clampPos(editor, opts.pos),
      selectionFrom: opts.selectionFrom !== undefined ? clampPos(editor, opts.selectionFrom) : undefined,
      selectionTo: opts.selectionTo !== undefined ? clampPos(editor, opts.selectionTo) : undefined,
    }
    // Ensure selection range is valid
    if (clamped.selectionFrom !== undefined && clamped.selectionTo !== undefined && clamped.selectionFrom >= clamped.selectionTo) {
      clamped.selectionFrom = undefined
      clamped.selectionTo = undefined
    }
    editor.commands.setAgentCursor(clamped)
  } catch { /* stale state, skip */ }
}

function safeRemoveCursor(editor: Editor, name: string) {
  try { editor.commands.removeAgentCursor(name) } catch { /* skip */ }
}

// Type text character by character at a position
function typeTextAt(
  editor: Editor,
  agentName: string,
  pos: number,
  text: string,
  timers: Record<string, number>,
  cb: ActionCallbacks
) {
  cb.onStateChange('editing')
  let charIdx = 0
  const typeNext = () => {
    if (charIdx < text.length) {
      const char = text[charIdx]
      editor.commands.insertContentAt(clampPos(editor, pos + charIdx), char)
      charIdx++
      safeCursor(editor, {
        name: agentName,
        color: AGENTS[agentName].color,
        pos: pos + charIdx,
      })
      timers[agentName] = window.setTimeout(typeNext, 25 + Math.random() * 45)
    } else {
      cb.onStateChange('idle')
      timers[agentName] = window.setTimeout(() => {
        safeRemoveCursor(editor, agentName)
        cb.onDone(true)
      }, 800)
    }
  }
  timers[agentName] = window.setTimeout(typeNext, 200)
}

// Execute an agent action on the editor
export function executeAgentAction(
  editor: Editor,
  agentName: string,
  action: AgentAction,
  editorLockRef: { current: string | null },
  timers: Record<string, number>,
  callbacks: ActionCallbacks
) {
  const needsLock = action.type === 'insert' || action.type === 'replace'

  // Atomic lock check: verify lock is still free at execution time
  if (needsLock && editorLockRef.current && editorLockRef.current !== agentName) {
    timers[agentName] = window.setTimeout(() => {
      // Re-check lock atomically before retrying
      if (editorLockRef.current && editorLockRef.current !== agentName) {
        timers[agentName] = window.setTimeout(() => executeAgentAction(editor, agentName, action, editorLockRef, timers, callbacks), 500 + Math.random() * 1000)
      } else {
        executeAgentAction(editor, agentName, action, editorLockRef, timers, callbacks)
      }
    }, 1000 + Math.random() * 1500)
    return
  }
  if (needsLock) editorLockRef.current = agentName

  const releaseLockAndDone = (success?: boolean) => {
    if (needsLock) editorLockRef.current = null
    callbacks.onDone(success)
  }

  const postChatBefore = () => {
    if (action.chatBefore && action.type !== 'chat') {
      callbacks.onChatMessage(agentName, `[from doc] ${action.chatBefore}`)
    }
  }

  const postChatAfter = () => {
    if (action.chatMessage && action.type !== 'chat') {
      callbacks.onChatMessage(agentName, `[from doc] ${action.chatMessage}`)
    }
  }

  if (action.type === 'read') {
    const found = action.highlightText ? findTextPos(editor, action.highlightText) : null
    const pos = found ? found.to : Math.min(10, editor.state.doc.content.size)
    callbacks.onStateChange('reading')
    safeCursor(editor, {
      name: agentName,
      color: AGENTS[agentName].color,
      pos,
      selectionFrom: found?.from,
      selectionTo: found?.to,
      thought: action.thought || 'Reading...',
    })
    timers[agentName] = window.setTimeout(() => {
      callbacks.onStateChange('idle')
      safeRemoveCursor(editor, agentName)
      postChatAfter()
      releaseLockAndDone(true)
    }, 3500)

  } else if (action.type === 'insert') {
    postChatBefore()
    const existingHeadings = getExistingHeadings(editor)
    const chunks = contentToBlocks(action.content || '').filter(chunk => {
      const headingMatch = chunk.match(/^<h[123]>(.*?)<\/h[123]>$/)
      if (headingMatch) {
        const headingText = headingMatch[1].trim().toLowerCase()
        if (existingHeadings.has(headingText)) {
          console.log('[agent-actions] skipping duplicate heading:', headingMatch[1])
          return false
        }
      }
      return true
    })

    if (chunks.length === 0) {
      releaseLockAndDone(false)
      return
    }

    let insertPos = editor.state.doc.content.size
    if (action.position === 'after-heading') {
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          insertPos = pos + node.nodeSize
        }
      })
    }

    callbacks.onStateChange('editing')
    safeCursor(editor, {
      name: agentName,
      color: AGENTS[agentName].color,
      pos: clampPos(editor, insertPos),
      thought: action.thought || 'Writing...',
    })

    let chunkIdx = 0
    const insertNext = () => {
      if (chunkIdx >= chunks.length) {
        timers[agentName] = window.setTimeout(() => {
          safeRemoveCursor(editor, agentName)
          callbacks.onStateChange('idle')
          postChatAfter()
          releaseLockAndDone(true)
        }, 600)
        return
      }
      const chunk = chunks[chunkIdx]
      const currentPos = Math.max(0, editor.state.doc.content.size - 1)
      editor.commands.insertContentAt(currentPos, chunk)
      const newPos = editor.state.doc.content.size
      safeCursor(editor, {
        name: agentName,
        color: AGENTS[agentName].color,
        pos: newPos,
        thought: action.thought || 'Writing...',
      })
      chunkIdx++
      timers[agentName] = window.setTimeout(insertNext, 400 + Math.random() * 600)
    }
    timers[agentName] = window.setTimeout(insertNext, 800)

  } else if (action.type === 'replace') {
    postChatBefore()
    const found = action.searchText ? findTextPos(editor, action.searchText) : null
    if (!found) {
      callbacks.onChatMessage(agentName, `[from doc] Couldn't find that text to replace. Can you be more specific?`)
      releaseLockAndDone(false)
      return
    }

    callbacks.onStateChange('editing')
    safeCursor(editor, {
      name: agentName,
      color: AGENTS[agentName].color,
      pos: found.to,
      selectionFrom: found.from,
      selectionTo: found.to,
      thought: action.thought || 'Rewriting...',
    })

    timers[agentName] = window.setTimeout(() => {
      editor.chain()
        .deleteRange({ from: found.from, to: found.to })
        .run()
      safeCursor(editor, {
        name: agentName,
        color: AGENTS[agentName].color,
        pos: found.from,
      })
      typeTextAt(editor, agentName, found.from, action.replaceWith || '', timers, {
        ...callbacks,
        onDone: (success) => { postChatAfter(); releaseLockAndDone(success) },
      })
    }, 1200)

  } else if (action.type === 'chat') {
    callbacks.onChatMessage(agentName, action.chatMessage || 'Got it.')
    releaseLockAndDone(true)
  }
}
