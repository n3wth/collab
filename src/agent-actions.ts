import type { Editor } from '@tiptap/react'
import type { AgentAction } from './agent'

const AGENTS: Record<string, { color: string, bgColor: string }> = {
  Aiden: { color: '#1a73e8', bgColor: '#e8f0fe' },
  Nova: { color: '#e37400', bgColor: '#fef7e0' },
}

export interface ActionCallbacks {
  onStateChange: (status: 'idle' | 'thinking' | 'typing' | 'reading' | 'editing', thought?: string) => void
  onChatMessage: (from: string, text: string) => void
  onDone: () => void
}

// Convert markdown-ish content to standalone HTML blocks for sequential insertion
function contentToBlocks(content: string): string[] {
  // Pre-process: normalize ### to ## , strip markdown bold/italic/code
  const cleaned = content
    .replace(/^#{3,}\s+/gm, '## ')  // ### or #### → ##
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold** → plain
    .replace(/\*(.+?)\*/g, '$1')     // *italic* → plain
    .replace(/`(.+?)`/g, '$1')       // `code` → plain
  const lines = cleaned.split('\n').filter(l => l.trim() !== '')
  const blocks: string[] = []
  // Track top-level and sub-level list items
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
    // Indented bullet (2+ spaces or tab before -) → sub-item
    if (/^[\t ]{2,}- /.test(line)) {
      const text = line.replace(/^[\t ]*- /, '')
      if (topItems.length > 0) {
        topItems[topItems.length - 1].subItems.push(text)
      } else {
        // No parent bullet — treat as top-level
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
  if (idx < 0) return null
  return { from: posMap[idx], to: posMap[idx + searchText.length - 1] + 1 }
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

// Safe cursor helpers — catch mismatched transaction errors
function safeCursor(editor: Editor, opts: { name: string, color: string, pos: number, selectionFrom?: number, selectionTo?: number, thought?: string }) {
  try { editor.commands.setAgentCursor(opts) } catch { /* stale state, skip */ }
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
      editor.commands.insertContentAt(pos + charIdx, char)
      charIdx++
      safeCursor(editor, {
        name: agentName,
        color: AGENTS[agentName].color,
        pos: pos + charIdx,
      })
      timers[agentName] = window.setTimeout(typeNext, 25 + Math.random() * 45)
    } else {
      cb.onStateChange('idle')
      setTimeout(() => {
        safeRemoveCursor(editor, agentName)
        cb.onDone()
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
  if (needsLock && editorLockRef.current && editorLockRef.current !== agentName) {
    setTimeout(() => executeAgentAction(editor, agentName, action, editorLockRef, timers, callbacks), 1000 + Math.random() * 1500)
    return
  }
  if (needsLock) editorLockRef.current = agentName

  const releaseLockAndDone = () => {
    if (needsLock) editorLockRef.current = null
    callbacks.onDone()
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
    setTimeout(() => {
      callbacks.onStateChange('idle')
      safeRemoveCursor(editor, agentName)
      postChatAfter()
      releaseLockAndDone()
    }, 3500)

  } else if (action.type === 'insert') {
    postChatBefore()
    const existingHeadings = getExistingHeadings(editor)
    // Filter out heading blocks that already exist in the document
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
      pos: insertPos,
      thought: action.thought || 'Writing...',
    })

    let chunkIdx = 0
    const insertNext = () => {
      if (chunkIdx >= chunks.length) {
        setTimeout(() => {
          safeRemoveCursor(editor, agentName)
          callbacks.onStateChange('idle')
          postChatAfter()
          releaseLockAndDone()
        }, 600)
        return
      }
      const chunk = chunks[chunkIdx]
      const currentPos = editor.state.doc.content.size - 1
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
      releaseLockAndDone()
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

    setTimeout(() => {
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
        onDone: () => { postChatAfter(); releaseLockAndDone() },
      })
    }, 1200)

  } else if (action.type === 'chat') {
    callbacks.onChatMessage(agentName, action.chatMessage || 'Got it.')
    releaseLockAndDone()
  }
}
