import { Extension } from '@tiptap/core'
import type { AgentCursorState } from './agent-cursor'
import './doc-minimap.css'

interface MinimapDot {
  name: string
  color: string
  state: 'idle' | 'reading' | 'thinking' | 'typing' | 'editing'
  y: number
  timestamp: number
}

interface LastKnownPosition {
  pos: number
  timestamp: number
}

const IDLE_TTL = 30_000
const THROTTLE_MS = 200

function resolveYRatio(editor: { view: { domAtPos: (pos: number) => { node: Node; offset: number } } }, pos: number, scrollContainer: HTMLElement): number | null {
  try {
    const { node } = editor.view.domAtPos(pos)
    const el = node instanceof HTMLElement ? node : node.parentElement
    if (!el) return null
    const offsetTop = (el as HTMLElement).offsetTop
    const scrollHeight = scrollContainer.scrollHeight
    if (scrollHeight <= 0) return null
    return offsetTop / scrollHeight
  } catch {
    return null
  }
}

function getSectionHeading(editor: { view: { domAtPos: (pos: number) => { node: Node; offset: number } } }, pos: number): string | null {
  try {
    const { node } = editor.view.domAtPos(pos)
    let el = node instanceof HTMLElement ? node : node.parentElement
    while (el && !el.classList?.contains('doc-editor')) {
      if (/^H[1-3]$/.test(el.tagName)) return el.textContent || null
      let prev = el.previousElementSibling
      while (prev) {
        if (/^H[1-3]$/.test(prev.tagName)) return prev.textContent || null
        prev = prev.previousElementSibling
      }
      el = el.parentElement
    }
    return null
  } catch {
    return null
  }
}

export interface DocMinimapOptions {
  agentColors: Record<string, string>
}

export const DocMinimap = Extension.create<DocMinimapOptions>({
  name: 'docMinimap',

  addOptions() {
    return {
      agentColors: {},
    }
  },

  addStorage() {
    return {
      lastKnownPositions: new Map<string, LastKnownPosition>(),
      _cleanup: null as (() => void) | null,
      _initialized: false,
    }
  },

  onCreate() {
    const editor = this.editor
    const options = this.options
    const storage = this.storage as {
      lastKnownPositions: Map<string, LastKnownPosition>
      _cleanup: (() => void) | null
      _initialized: boolean
    }

    const tryInit = () => {
      if (storage._initialized) return
      const editorEl = editor.view.dom
      const docBody = editorEl.closest('.doc-body')
      const docPanel = editorEl.closest('.doc-panel')
      if (!docBody || !docPanel) return
      storage._initialized = true
      if (observer) observer.disconnect()
      initMinimap(editorEl, docBody as HTMLElement, docPanel as HTMLElement)
    }

    // The doc-panel is conditionally rendered — editor may not be in it yet.
    // Poll on transactions AND observe DOM to detect when it appears.
    editor.on('transaction', tryInit)

    // Observe #root for the editor element being reparented (not full document.body)
    const observer = new MutationObserver(() => tryInit())
    const root = document.getElementById('root') || document.body
    observer.observe(root, { childList: true, subtree: true })

    // Try immediately in case doc-panel is already open
    requestAnimationFrame(tryInit)

    const initMinimap = (_editorEl: HTMLElement, docBody: HTMLElement, docPanel: HTMLElement) => {
      // Stop listening for init
      editor.off('transaction', tryInit)

    // Create minimap strip
    const strip = document.createElement('div')
    strip.className = 'doc-minimap'
    docBody.appendChild(strip)

    // Tooltip element
    const tooltip = document.createElement('div')
    tooltip.className = 'doc-minimap-tooltip'
    strip.appendChild(tooltip)

    // Viewport indicator bar
    const viewportBar = document.createElement('div')
    viewportBar.className = 'doc-minimap-viewport'
    strip.appendChild(viewportBar)

    // Track dots
    const dotEls = new Map<string, HTMLElement>()
    let userDot: HTMLElement | null = null
    let throttleTimer: number | null = null

    const getAgentStates = (): Map<string, { name: string; color: string; pos: number }> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cursors = ((editor.storage as any).agentCursors?.cursors || []) as AgentCursorState[]
      const result = new Map<string, { name: string; color: string; pos: number }>()
      for (const c of cursors) {
        result.set(c.name, { name: c.name, color: c.color, pos: c.pos })
      }
      return result
    }

    const update = () => {
      const scrollEl = docBody as HTMLElement
      const minimapHeight = strip.clientHeight
      if (minimapHeight <= 0) return

      const now = Date.now()

      // Update last known positions from current cursors
      const currentCursors = getAgentStates()
      for (const [name, cursor] of currentCursors) {
        storage.lastKnownPositions.set(name, { pos: cursor.pos, timestamp: now })
      }

      // Collect all dots to render
      const dots: MinimapDot[] = []

      for (const [name, lkp] of storage.lastKnownPositions) {
        const age = now - lkp.timestamp
        if (age > IDLE_TTL) {
          storage.lastKnownPositions.delete(name)
          continue
        }

        const yRatio = resolveYRatio(editor, lkp.pos, scrollEl)
        if (yRatio === null) continue

        const isActive = currentCursors.has(name)
        let state: MinimapDot['state'] = 'idle'
        if (isActive) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cursorData = (((editor.storage as any).agentCursors?.cursors || []) as AgentCursorState[]).find((c: AgentCursorState) => c.name === name)
          if (cursorData?.thought) {
            state = cursorData.thought.toLowerCase().includes('read') ? 'reading' : 'thinking'
          } else {
            state = 'typing'
          }
        }

        const color = currentCursors.get(name)?.color || options.agentColors[name] || '#888'

        dots.push({
          name,
          color,
          state,
          y: yRatio * minimapHeight,
          timestamp: lkp.timestamp,
        })
      }

      // Handle overlapping dots: stack with 2px offset when within 10px
      dots.sort((a, b) => a.y - b.y)
      for (let i = 1; i < dots.length; i++) {
        if (Math.abs(dots[i].y - dots[i - 1].y) < 10) {
          dots[i].y = dots[i - 1].y + 2
        }
      }

      // Reconcile DOM
      const activeDotNames = new Set(dots.map(d => d.name))

      for (const [name, el] of dotEls) {
        if (!activeDotNames.has(name)) {
          el.remove()
          dotEls.delete(name)
        }
      }

      for (const dot of dots) {
        let el = dotEls.get(dot.name)
        if (!el) {
          el = document.createElement('div')
          el.className = 'doc-minimap-dot'
          el.dataset.agent = dot.name
          strip.appendChild(el)
          dotEls.set(dot.name, el)

          el.addEventListener('mouseenter', (ev) => {
            const heading = getSectionHeading(editor, storage.lastKnownPositions.get(dot.name)?.pos ?? 0)
            tooltip.textContent = heading ? `${dot.name} — ${heading}` : dot.name
            tooltip.style.display = 'block'
            const rect = (ev.target as HTMLElement).getBoundingClientRect()
            const stripRect = strip.getBoundingClientRect()
            tooltip.style.top = `${rect.top - stripRect.top}px`
          })
          el.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none'
          })
          el.addEventListener('click', () => {
            const lkp = storage.lastKnownPositions.get(dot.name)
            if (!lkp) return
            try {
              const { node } = editor.view.domAtPos(lkp.pos)
              const targetEl = node instanceof HTMLElement ? node : node.parentElement
              targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            } catch { /* ignore */ }
          })
        }

        el.style.backgroundColor = dot.color
        el.style.top = `${dot.y}px`

        let opacity = 0.2
        if (dot.state === 'reading') opacity = 0.6
        else if (dot.state === 'thinking') opacity = 0.6
        else if (dot.state === 'typing' || dot.state === 'editing') opacity = 1

        el.style.opacity = String(opacity)
        el.classList.toggle('doc-minimap-dot-thinking', dot.state === 'thinking')
      }

      // Viewport indicator bar
      const scrollHeight = scrollEl.scrollHeight
      if (scrollHeight > 0 && minimapHeight > 0) {
        const viewportTop = scrollEl.scrollTop / scrollHeight
        const viewportHeight = scrollEl.clientHeight / scrollHeight
        viewportBar.style.top = `${viewportTop * minimapHeight}px`
        viewportBar.style.height = `${Math.max(viewportHeight * minimapHeight, 12)}px`
      }

      // User cursor dot
      const userPos = editor.state.selection.from
      const userYRatio = resolveYRatio(editor, userPos, scrollEl)
      if (userYRatio !== null) {
        if (!userDot) {
          userDot = document.createElement('div')
          userDot.className = 'doc-minimap-dot doc-minimap-dot-user'
          strip.appendChild(userDot)
        }
        userDot.style.top = `${userYRatio * minimapHeight}px`
      }
    }

    const throttledUpdate = () => {
      if (throttleTimer) return
      throttleTimer = window.setTimeout(() => {
        throttleTimer = null
        update()
      }, THROTTLE_MS)
    }

    const onTransaction = () => throttledUpdate()
    editor.on('transaction', onTransaction)

    const onSelectionUpdate = () => throttledUpdate()
    editor.on('selectionUpdate', onSelectionUpdate)

    const onScroll = () => throttledUpdate()
    ;(docBody as HTMLElement).addEventListener('scroll', onScroll, { passive: true })

    const resizeObserver = new ResizeObserver(() => throttledUpdate())
    resizeObserver.observe(docPanel as HTMLElement)

    strip.addEventListener('mouseenter', () => {
      strip.classList.add('doc-minimap-hover')
    })
    strip.addEventListener('mouseleave', () => {
      strip.classList.remove('doc-minimap-hover')
      tooltip.style.display = 'none'
    })

    storage._cleanup = () => {
      editor.off('transaction', onTransaction)
      editor.off('selectionUpdate', onSelectionUpdate)
      ;(docBody as HTMLElement).removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
      if (throttleTimer) clearTimeout(throttleTimer)
      strip.remove()
    }

    // Initial render
    requestAnimationFrame(() => update())
    } // end initMinimap
  },

  onDestroy() {
    const cleanup = (this.storage as { _cleanup: (() => void) | null })._cleanup
    cleanup?.()
  },
})
