import type { Editor } from '@tiptap/react'
import type { AgentAction } from './agent'

export interface DocChangeInfo {
  type: 'insert' | 'replace' | 'delete'
  summary: string
  added?: string
  removed?: string
}

export interface ActionCallbacks {
  onStateChange: (status: 'idle' | 'thinking' | 'typing' | 'reading' | 'editing', thought?: string) => void
  onChatMessage: (from: string, text: string, docChange?: DocChangeInfo) => void
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

// Scroll the editor so the cursor position is visible.
// Debounced to avoid competing scroll calls.
let scrollTimer: number | null = null
function scrollToPos(editor: Editor, pos: number) {
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = window.setTimeout(() => {
    scrollTimer = null
    try {
      const clamped = clampPos(editor, pos)
      const coords = editor.view.coordsAtPos(clamped)
      const scrollParent = editor.view.dom.closest('.doc-body')
      if (!scrollParent || !coords) return
      const rect = scrollParent.getBoundingClientRect()
      const cursorY = coords.top - rect.top + scrollParent.scrollTop
      const viewTop = scrollParent.scrollTop
      const viewBottom = viewTop + rect.height
      if (cursorY < viewTop + 40 || cursorY > viewBottom - 40) {
        // Place cursor at 40% from top — precise, minimal overshoot
        scrollParent.scrollTo({ top: Math.max(0, cursorY - rect.height * 0.4), behavior: 'smooth' })
      }
    } catch { /* coords can fail at doc boundaries */ }
  }, 100)
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

// Insert text at a position and place cursor at the end (used by replace)
function typeTextAt(
  editor: Editor,
  agentName: string,
  agentColor: string,
  pos: number,
  text: string,
  timers: Record<string, number>,
  cb: ActionCallbacks
) {
  cb.onStateChange('editing')
  try {
    const tr = editor.view.state.tr.insertText(text, clampPos(editor, pos))
    editor.view.dispatch(tr)
  } catch { /* best effort */ }
  safeCursor(editor, {
    name: agentName,
    color: agentColor,
    pos: clampPos(editor, pos + text.length),
  }, true)
  timers[agentName] = window.setTimeout(() => {
    cb.onStateChange('idle')
    timers[agentName] = window.setTimeout(() => {
      safeRemoveCursor(editor, agentName)
      cb.onDone(true)
    }, 800)
  }, 400)
}

// Execute an agent action on the editor
export function executeAgentAction(
  editor: Editor,
  agentName: string,
  agentColor: string,
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
      () => executeAgentAction(editor, agentName, agentColor, action, editorLockRef, timers, callbacks),
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
    callbacks.onStateChange('reading')

    // Collect block positions to scan through
    const positions: number[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.isBlock && node.textContent.length > 0) {
        positions.push(pos + 1) // +1 to enter the block
      }
    })
    // If we have a specific target, scan up to it; otherwise scan the whole doc
    const found = action.highlightText ? findTextPos(editor, action.highlightText) : null
    const targetPos = found ? found.from : positions[positions.length - 1] || 1

    // Pick waypoints leading to the target — more points = smoother movement
    const waypoints = positions.filter(p => p <= targetPos)
    const maxPoints = 12
    const step = Math.max(1, Math.floor(waypoints.length / maxPoints))
    const scanPoints = waypoints.filter((_, i) => i % step === 0)
    if (found) scanPoints.push(found.from) // always end at target

    let scanIdx = 0
    const SCAN_INTERVAL = 280

    function advanceScan() {
      if (scanIdx >= scanPoints.length) {
        // Done scanning — hold on target briefly, then finish
        if (found) {
          safeCursor(editor, {
            name: agentName,
            color: agentColor,
            pos: found.to,
            selectionFrom: found.from,
            selectionTo: found.to,
            thought: action.thought || 'Found it',
          }, true)
        }
        timers[agentName] = window.setTimeout(() => {
          callbacks.onStateChange('idle')
          safeRemoveCursor(editor, agentName)
          postChatAfter()
          releaseLockAndDone(true)
        }, 1200)
        return
      }
      const p = scanPoints[scanIdx]
      safeCursor(editor, {
        name: agentName,
        color: agentColor,
        pos: p,
        thought: scanIdx < scanPoints.length - 1 ? 'Scanning...' : (action.thought || 'Reading...'),
      }, true)
      scanIdx++
      timers[agentName] = window.setTimeout(advanceScan, SCAN_INTERVAL)
    }

    advanceScan()

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

    if (action.position && action.position.startsWith('after:')) {
      // Target a specific heading: "after:Architecture" or "after:Open Questions"
      const targetHeading = action.position.slice(6).trim().toLowerCase()
      let foundHeading = false
      editor.state.doc.descendants((node, pos) => {
        if (foundHeading) return false // stop after finding the target section
        if (node.type.name === 'heading') {
          const headingText = node.textContent.trim().toLowerCase()
          if (headingText === targetHeading || headingText.includes(targetHeading)) {
            // Insert after this heading's content block
            // Walk forward to find the end of this section (next heading or doc end)
            let sectionEnd = pos + node.nodeSize
            let foundNext = false
            editor.state.doc.descendants((innerNode, innerPos) => {
              if (foundNext) return false
              if (innerPos > pos && innerNode.type.name === 'heading') {
                sectionEnd = innerPos
                foundNext = true
                return false
              }
              if (innerPos > pos) {
                sectionEnd = innerPos + innerNode.nodeSize
              }
            })
            insertPos = sectionEnd
            foundHeading = true
            return false
          }
        }
      })
    } else if (action.position === 'after-heading') {
      // Legacy: insert after the last heading
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          insertPos = pos + node.nodeSize
        }
      })
    }

    callbacks.onStateChange('editing')
    safeCursor(editor, {
      name: agentName,
      color: agentColor,
      pos: clampPos(editor, insertPos),
      thought: action.thought || 'Writing...',
    }, true)

    // Group consecutive listItem blocks into single bulletList insertions
    // to avoid creating separate <ul> nodes with gaps between them.
    type InsertOp = { type: 'list', items: { text: string, subItems?: string[] }[] }
      | { type: 'heading', text: string, level: number }
      | { type: 'paragraph', text: string }
    const insertOps: InsertOp[] = []
    for (const block of streamBlocks) {
      if (block.type === 'listItem') {
        const last = insertOps[insertOps.length - 1]
        if (last && last.type === 'list') {
          last.items.push({ text: block.text, subItems: block.subItems })
        } else {
          insertOps.push({ type: 'list', items: [{ text: block.text, subItems: block.subItems }] })
        }
      } else if (block.type === 'heading') {
        insertOps.push({ type: 'heading', text: block.text, level: block.level || 2 })
      } else {
        insertOps.push({ type: 'paragraph', text: block.text })
      }
    }

    let opIdx = 0
    const streamNextOp = () => {
      if (opIdx >= insertOps.length) {
        timers[agentName] = window.setTimeout(() => {
          safeRemoveCursor(editor, agentName)
          callbacks.onStateChange('idle')
          postChatAfter()
          releaseLockAndDone(true)
        }, 600)
        return
      }

      const op = insertOps[opIdx]
      opIdx++

      // Remove trailing empty paragraphs before inserting — prevents gaps.
      // Only remove if doc has more than one child (Tiptap always keeps at least one block).
      const doc = editor.state.doc
      if (doc.childCount > 1) {
        let tr = editor.view.state.tr
        let removed = false
        for (let i = doc.childCount - 1; i >= 1; i--) {
          const child = doc.child(i)
          if (child.type.name === 'paragraph' && child.content.size === 0) {
            let pos = 0
            for (let j = 0; j < i; j++) pos += doc.child(j).nodeSize
            tr = tr.delete(pos, pos + child.nodeSize)
            removed = true
          } else {
            break
          }
        }
        if (removed) {
          try { editor.view.dispatch(tr) } catch { /* skip */ }
        }
      }

      const endPos = editor.state.doc.content.size

      // After inserting, clean up any empty paragraphs that ProseMirror added
      const cleanupEmptyParagraphs = () => {
        const d = editor.state.doc
        const tr = editor.view.state.tr
        let cleaned = false
        // Walk backwards to find empty paragraphs between headings/lists
        for (let i = d.childCount - 1; i >= 1; i--) {
          const child = d.child(i)
          const prev = d.child(i - 1)
          if (child.type.name === 'paragraph' && child.content.size === 0 &&
              (prev.type.name === 'heading' || prev.type.name === 'bulletList')) {
            let pos = 0
            for (let j = 0; j < i; j++) pos += d.child(j).nodeSize
            tr.delete(pos, pos + child.nodeSize)
            cleaned = true
          }
        }
        if (cleaned) {
          try { editor.view.dispatch(tr) } catch { /* skip */ }
        }
      }

      if (op.type === 'list') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items: any[] = []
        for (const item of op.items) {
          items.push({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: item.text }] }] })
          if (item.subItems) {
            for (const sub of item.subItems) {
              items.push({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: sub }] }] })
            }
          }
        }

        // Check if the last non-empty block is a bulletList — append to it instead of creating a new one
        const currentDoc = editor.state.doc
        let lastBlockIdx = currentDoc.childCount - 1
        while (lastBlockIdx >= 0 && currentDoc.child(lastBlockIdx).type.name === 'paragraph' && currentDoc.child(lastBlockIdx).content.size === 0) {
          lastBlockIdx--
        }
        if (lastBlockIdx >= 0 && currentDoc.child(lastBlockIdx).type.name === 'bulletList') {
          // Calculate position just before the bulletList closing tag
          let pos = 0
          for (let j = 0; j <= lastBlockIdx; j++) pos += currentDoc.child(j).nodeSize
          const insertAt = pos - 1 // inside the bulletList, after the last listItem

          // Build listItem nodes via the schema
          const schema = editor.state.schema
          const newItems = items.map((item: { type: string, content: { type: string, content?: { type: string, text: string }[] }[] }) => {
            const textContent = item.content[0]?.content?.[0]?.text || ''
            return schema.nodes.listItem.create(null, [
              schema.nodes.paragraph.create(null, textContent ? [schema.text(textContent)] : [])
            ])
          })

          // Single transaction to append all items
          const tr = editor.view.state.tr
          for (let i = newItems.length - 1; i >= 0; i--) {
            tr.insert(insertAt, newItems[i])
          }
          try { editor.view.dispatch(tr) } catch { /* skip */ }
        } else {
          editor.commands.insertContentAt(endPos, { type: 'bulletList', content: items })
        }
      } else if (op.type === 'heading') {
        editor.commands.insertContentAt(endPos, { type: 'heading', attrs: { level: op.level }, content: [{ type: 'text', text: op.text }] })
      } else {
        editor.commands.insertContentAt(endPos, { type: 'paragraph', content: [{ type: 'text', text: op.text }] })
      }

      // Clean up empty paragraphs ProseMirror inserts between blocks
      cleanupEmptyParagraphs()

      // Fade in the newly inserted node
      const editorEl = editor.view.dom
      const lastChild = editorEl.lastElementChild
      if (lastChild && !lastChild.classList.contains('agent-fade-in')) {
        lastChild.classList.add('agent-fade-in')
      }

      // Cursor at end of inserted content
      const newEnd = clampPos(editor, editor.state.doc.content.size - 1)
      safeCursor(editor, {
        name: agentName,
        color: agentColor,
        pos: newEnd,
        thought: action.thought || 'Writing...',
      }, true)

      timers[agentName] = window.setTimeout(streamNextOp, 300 + Math.random() * 400)
    }

    timers[agentName] = window.setTimeout(streamNextOp, 600)

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
      color: agentColor,
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
        color: agentColor,
        pos: found.from,
      })
      typeTextAt(editor, agentName, agentColor, found.from, action.replaceWith || '', timers, {
        ...callbacks,
        onDone: (success) => { postChatAfter(); releaseLockAndDone(success) },
      })
    }, 1200)

  } else if (action.type === 'search') {
    // Search action: fire a web search request
    callbacks.onChatMessage(agentName, `[from doc] Researching: ${action.query || ''}...`)
    callbacks.onStateChange('thinking', 'Searching...')

    fetch('/api/tavily/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: action.query, maxResults: 3 }),
    })
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`Search failed: ${res.status}`)))
      .then(data => {
        const results = data.results || []
        if (results.length > 0) {
          // Synthesize findings into a brief summary instead of dumping raw results
          const snippets = results.map((r: { title: string, url: string, content: string }) =>
            r.content.slice(0, 200)
          )
          const synthesis = snippets.join(' ').slice(0, 500)
          const sourceList = results.map((r: { title: string, url: string }) => r.url).join(', ')
          callbacks.onChatMessage(agentName, `Researched "${action.query}": ${synthesis}... (sources: ${sourceList})`)
        } else {
          callbacks.onChatMessage(agentName, `Couldn't find relevant results for "${action.query}".`)
        }
        callbacks.onStateChange('idle')
        releaseLockAndDone(true)
      })
      .catch(() => {
        callbacks.onChatMessage(agentName, `Search unavailable right now. Continuing without it.`)
        callbacks.onStateChange('idle')
        releaseLockAndDone(true)
      })

  } else if (action.type === 'chat') {
    callbacks.onChatMessage(agentName, action.chatMessage || 'Got it.')
    releaseLockAndDone(true)
  }
}
