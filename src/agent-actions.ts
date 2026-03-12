import type { Editor } from '@tiptap/react'
import type { AgentAction } from './agent'

const AGENTS: Record<string, { color: string, bgColor: string }> = {
  Aiden: { color: '#5f6368', bgColor: '#f1f3f5' },
  Nova: { color: '#5f6368', bgColor: '#f1f3f5' },
}

export interface ActionCallbacks {
  onStateChange: (status: 'idle' | 'thinking' | 'typing' | 'reading' | 'editing', thought?: string) => void
  onChatMessage: (from: string, text: string) => void
  onDone: (success?: boolean) => void
}

// Represents a single streamable piece of content
interface StreamBlock {
  // 'heading', 'paragraph', 'listItem' — determines the wrapper node
  type: 'heading' | 'paragraph' | 'listItem'
  text: string
  level?: number // for headings (2 = h2)
  subItems?: string[] // for list items with children
}

// Convert markdown-ish content to streamable blocks
function contentToStreamBlocks(content: string): StreamBlock[] {
  const cleaned = content
    .replace(/^#{3,}\s+/gm, '## ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
  const lines = cleaned.split('\n').filter(l => l.trim() !== '')
  const blocks: StreamBlock[] = []
  let pendingListItems: { text: string, subItems: string[] }[] = []

  const flushList = () => {
    for (const item of pendingListItems) {
      blocks.push({ type: 'listItem', text: item.text, subItems: item.subItems.length > 0 ? item.subItems : undefined })
    }
    pendingListItems = []
  }

  for (const line of lines) {
    if (/^[\t ]{2,}- /.test(line)) {
      const text = line.replace(/^[\t ]*- /, '')
      if (pendingListItems.length > 0) {
        pendingListItems[pendingListItems.length - 1].subItems.push(text)
      } else {
        pendingListItems.push({ text, subItems: [] })
      }
    } else if (line.startsWith('- ')) {
      pendingListItems.push({ text: line.slice(2), subItems: [] })
    } else {
      flushList()
      if (line.startsWith('## ')) {
        blocks.push({ type: 'heading', text: line.slice(3), level: 2 })
      } else if (line.startsWith('# ')) {
        blocks.push({ type: 'heading', text: line.slice(2), level: 1 })
      } else {
        blocks.push({ type: 'paragraph', text: line })
      }
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

// Scroll the editor view so a position is visible
function scrollToPos(editor: Editor, pos: number) {
  try {
    const clamped = clampPos(editor, pos)
    const coords = editor.view.coordsAtPos(clamped)
    const scrollParent = editor.view.dom.closest('.doc-body')
    if (!scrollParent || !coords) return
    const rect = scrollParent.getBoundingClientRect()
    const cursorY = coords.top - rect.top + scrollParent.scrollTop
    const viewTop = scrollParent.scrollTop
    const viewBottom = viewTop + rect.height
    if (cursorY < viewTop + 60 || cursorY > viewBottom - 80) {
      scrollParent.scrollTo({ top: Math.max(0, cursorY - rect.height / 3), behavior: 'smooth' })
    }
  } catch { /* coords can fail at doc boundaries */ }
}

// Safe cursor helpers — catch mismatched transaction errors
function safeCursor(editor: Editor, opts: { name: string, color: string, pos: number, selectionFrom?: number, selectionTo?: number, thought?: string }, scroll = false) {
  try {
    const clamped = {
      ...opts,
      pos: clampPos(editor, opts.pos),
      selectionFrom: opts.selectionFrom !== undefined ? clampPos(editor, opts.selectionFrom) : undefined,
      selectionTo: opts.selectionTo !== undefined ? clampPos(editor, opts.selectionTo) : undefined,
    }
    if (clamped.selectionFrom !== undefined && clamped.selectionTo !== undefined && clamped.selectionFrom >= clamped.selectionTo) {
      clamped.selectionFrom = undefined
      clamped.selectionTo = undefined
    }
    editor.commands.setAgentCursor(clamped)
    if (scroll) {
      scrollToPos(editor, clamped.pos)
    }
  } catch { /* stale state, skip */ }
}

function safeRemoveCursor(editor: Editor, name: string) {
  try { editor.commands.removeAgentCursor(name) } catch { /* skip */ }
}

// Stream-type text into the editor at a position, word by word
// Uses a running position tracker to avoid stale offset math
function streamTypeAt(
  editor: Editor,
  agentName: string,
  startPos: number,
  text: string,
  timers: Record<string, number>,
  onChar?: () => void,
): Promise<void> {
  return new Promise(resolve => {
    // Split into small chunks (words + trailing space) for natural typing feel
    const chunks: string[] = []
    const words = text.split(/(\s+)/)
    for (const w of words) {
      if (w) chunks.push(w)
    }
    let chunkIdx = 0
    let currentPos = startPos

    const typeNext = () => {
      if (chunkIdx < chunks.length) {
        const chunk = chunks[chunkIdx]
        try {
          editor.commands.insertContentAt(clampPos(editor, currentPos), chunk)
          currentPos += chunk.length
          chunkIdx++
        } catch {
          // Position invalid, skip this chunk
          chunkIdx++
        }
        safeCursor(editor, {
          name: agentName,
          color: AGENTS[agentName].color,
          pos: currentPos,
        }, chunkIdx % 6 === 0)
        onChar?.()
        // Vary timing: faster for spaces, slower for content words
        const delay = chunk.trim() ? 30 + Math.random() * 50 : 10
        timers[agentName] = window.setTimeout(typeNext, delay)
      } else {
        resolve()
      }
    }
    timers[agentName] = window.setTimeout(typeNext, 50)
  })
}

// Type text word by word at a position (used by replace)
function typeTextAt(
  editor: Editor,
  agentName: string,
  pos: number,
  text: string,
  timers: Record<string, number>,
  cb: ActionCallbacks
) {
  cb.onStateChange('editing')
  streamTypeAt(editor, agentName, pos, text, timers).then(() => {
    cb.onStateChange('idle')
    timers[agentName] = window.setTimeout(() => {
      safeRemoveCursor(editor, agentName)
      cb.onDone(true)
    }, 800)
  })
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
    const retries = (action as { _lockRetries?: number })._lockRetries || 0
    if (retries >= 6) {
      // Give up after ~10s of waiting
      console.warn(`[agent-actions] ${agentName} gave up waiting for lock held by ${editorLockRef.current}`)
      callbacks.onDone(false)
      return
    }
    (action as { _lockRetries?: number })._lockRetries = retries + 1
    timers[agentName] = window.setTimeout(
      () => executeAgentAction(editor, agentName, action, editorLockRef, timers, callbacks),
      800 + Math.random() * 1200
    )
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
    }, true) // scroll to reading position
    timers[agentName] = window.setTimeout(() => {
      callbacks.onStateChange('idle')
      safeRemoveCursor(editor, agentName)
      postChatAfter()
      releaseLockAndDone(true)
    }, 3500)

  } else if (action.type === 'insert') {
    postChatBefore()
    const existingHeadings = getExistingHeadings(editor)

    // Parse into stream blocks and filter duplicate headings
    const streamBlocks = contentToStreamBlocks(action.content || '').filter(block => {
      if (block.type === 'heading') {
        if (existingHeadings.has(block.text.trim().toLowerCase())) {
          console.log('[agent-actions] skipping duplicate heading:', block.text)
          return false
        }
      }
      return true
    })

    if (streamBlocks.length === 0) {
      releaseLockAndDone(false)
      return
    }

    // Determine insert position
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
    }, true)

    // Stream each block: insert empty node, then type text into it
    let blockIdx = 0
    const streamNextBlock = () => {
      if (blockIdx >= streamBlocks.length) {
        timers[agentName] = window.setTimeout(() => {
          safeRemoveCursor(editor, agentName)
          callbacks.onStateChange('idle')
          postChatAfter()
          releaseLockAndDone(true)
        }, 600)
        return
      }

      const block = streamBlocks[blockIdx]
      blockIdx++

      // All block types: insert empty structure, then stream-type text
      const currentPos = Math.max(0, editor.state.doc.content.size - 1)

      if (block.type === 'listItem') {
        editor.commands.insertContentAt(currentPos, '<ul><li> </li></ul>')
      } else if (block.type === 'heading') {
        const tag = `h${block.level || 2}`
        editor.commands.insertContentAt(currentPos, `<${tag}> </${tag}>`)
      } else {
        editor.commands.insertContentAt(currentPos, '<p> </p>')
      }

      // Text position inside the new node (list items have extra <ul> wrapper)
      const textPos = currentPos + (block.type === 'listItem' ? 2 : 1)

      // Delete placeholder space
      try {
        editor.chain().deleteRange({ from: textPos, to: textPos + 1 }).run()
      } catch { /* positions may shift */ }

      safeCursor(editor, {
        name: agentName,
        color: AGENTS[agentName].color,
        pos: textPos,
        thought: action.thought || 'Writing...',
      }, true)

      // Stream-type the text content character by character
      streamTypeAt(editor, agentName, textPos, block.text, timers).then(() => {
        // If list item has sub-items, stream those sequentially too
        if (block.type === 'listItem' && block.subItems && block.subItems.length > 0) {
          let subIdx = 0
          const streamNextSub = () => {
            if (subIdx >= block.subItems!.length) {
              timers[agentName] = window.setTimeout(streamNextBlock, 200 + Math.random() * 300)
              return
            }
            const subText = block.subItems![subIdx]
            subIdx++
            const subPos = Math.max(0, editor.state.doc.content.size - 1)
            editor.commands.insertContentAt(subPos, '<ul><li> </li></ul>')
            const subTextPos = subPos + 2
            try {
              editor.chain().deleteRange({ from: subTextPos, to: subTextPos + 1 }).run()
            } catch { /* skip */ }
            safeCursor(editor, {
              name: agentName,
              color: AGENTS[agentName].color,
              pos: subTextPos,
              thought: action.thought || 'Writing...',
            }, true)
            streamTypeAt(editor, agentName, subTextPos, subText, timers).then(() => {
              timers[agentName] = window.setTimeout(streamNextSub, 150 + Math.random() * 200)
            })
          }
          timers[agentName] = window.setTimeout(streamNextSub, 150)
        } else {
          timers[agentName] = window.setTimeout(streamNextBlock, 200 + Math.random() * 300)
        }
      })
    }

    timers[agentName] = window.setTimeout(streamNextBlock, 600)

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
    }, true) // scroll to replace position

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
