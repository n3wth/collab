import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { createNoise3D } from 'simplex-noise'

const cursorNoise = createNoise3D()
const BLOB_POINTS = 6

function createBlobCanvas(name: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const dpr = window.devicePixelRatio || 1
  canvas.width = size * dpr
  canvas.height = size * dpr
  canvas.style.width = `${size}px`
  canvas.style.height = `${size}px`

  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  const isAiden = name === 'Aiden'
  const seed = isAiden ? 1 : 2
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.34
  let t = Math.random() * 100

  function draw() {
    t += 0.008
    ctx.clearRect(0, 0, size, size)

    let d = ''
    const pts: [number, number][] = []
    for (let i = 0; i < BLOB_POINTS; i++) {
      const angle = (Math.PI * 2 * i) / BLOB_POINTS
      const n = cursorNoise(Math.cos(angle) + seed, Math.sin(angle) + seed, t)
      const rad = r * (1 + n * 0.1)
      pts.push([cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad])
    }
    for (let i = 0; i < BLOB_POINTS; i++) {
      const p0 = pts[(i - 1 + BLOB_POINTS) % BLOB_POINTS]
      const p1 = pts[i]
      const p2 = pts[(i + 1) % BLOB_POINTS]
      const p3 = pts[(i + 2) % BLOB_POINTS]
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6
      if (i === 0) d += `M${p1[0].toFixed(1)},${p1[1].toFixed(1)}`
      d += `C${cp1x.toFixed(1)},${cp1y.toFixed(1)},${cp2x.toFixed(1)},${cp2y.toFixed(1)},${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
    }
    d += 'Z'

    const path = new Path2D(d)
    if (isAiden) {
      ctx.fillStyle = '#1a1a1a'
      ctx.fill(path)
    } else {
      ctx.strokeStyle = '#1a1a1a'
      ctx.lineWidth = size * 0.07
      ctx.stroke(path)
    }

    // Only schedule next frame while canvas is in the DOM; stops loop when decoration is removed
    if (canvas.isConnected) {
      requestAnimationFrame(draw)
    }
  }
  draw()

  return canvas
}

export interface AgentCursorState {
  name: string
  color: string
  pos: number
  selectionFrom?: number
  selectionTo?: number
  thought?: string
  fading?: boolean
}

const agentCursorKey = new PluginKey('agentCursors')

export const AgentCursors = Extension.create({
  name: 'agentCursors',

  addStorage() {
    return {
      cursors: [] as AgentCursorState[],
    }
  },

  addCommands() {
    return {
      setAgentCursor: (cursor: AgentCursorState) => ({ editor }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (editor.storage as any).agentCursors
        const cursors = store.cursors as AgentCursorState[]
        store.cursors = [...cursors.filter((c: AgentCursorState) => c.name !== cursor.name), cursor]
        editor.view.dispatch(editor.view.state.tr.setMeta(agentCursorKey, true))
        return true
      },
      removeAgentCursor: (name: string) => ({ editor }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (editor.storage as any).agentCursors
        store.cursors = (store.cursors as AgentCursorState[]).filter((c: AgentCursorState) => c.name !== name)
        editor.view.dispatch(editor.view.state.tr.setMeta(agentCursorKey, true))
        return true
      },
    }
  },

  onDestroy() {
    this.storage.cursors = []
  },

  addProseMirrorPlugins() {
    const ext = this

    return [
      new Plugin({
        key: agentCursorKey,
        props: {
          decorations(state) {
            const cursors = ext.storage.cursors as AgentCursorState[]
            if (cursors.length === 0) return DecorationSet.empty

            const decorations: Decoration[] = []

            for (const cursor of cursors) {
              const pos = Math.min(cursor.pos, state.doc.content.size)

              // Cursor line widget
              const cursorEl = document.createElement('span')
              cursorEl.className = `agent-cursor-line ${cursor.fading ? 'cursor-fading' : ''}`
              cursorEl.style.borderColor = '#1a1a1a'

              // Avatar + thought container
              const container = document.createElement('span')
              container.className = `agent-cursor-head ${cursor.fading ? 'cursor-fading' : ''}`

              const avatarWrap = document.createElement('span')
              avatarWrap.className = 'agent-cursor-avatar'
              avatarWrap.style.background = 'transparent'
              const blobCanvas = createBlobCanvas(cursor.name, 16)
              blobCanvas.style.display = 'block'
              avatarWrap.appendChild(blobCanvas)
              container.appendChild(avatarWrap)

              if (cursor.thought) {
                const thought = document.createElement('span')
                thought.className = 'agent-cursor-thought'
                thought.style.background = '#1a1a1a'
                thought.textContent = cursor.thought
                container.appendChild(thought)
              }

              decorations.push(
                Decoration.widget(pos, cursorEl, { side: -1, key: `cursor-${cursor.name}` }),
                Decoration.widget(pos, container, { side: -1, key: `head-${cursor.name}` }),
              )

              // Selection highlight
              if (cursor.selectionFrom !== undefined && cursor.selectionTo !== undefined) {
                const from = Math.max(0, Math.min(cursor.selectionFrom, state.doc.content.size))
                const to = Math.max(0, Math.min(cursor.selectionTo, state.doc.content.size))
                if (from < to) {
                  decorations.push(
                    Decoration.inline(from, to, {
                      style: `background: ${cursor.color}30;`,
                    }, { key: `sel-${cursor.name}` })
                  )
                }
              }
            }

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    agentCursors: {
      setAgentCursor: (cursor: AgentCursorState) => ReturnType
      removeAgentCursor: (name: string) => ReturnType
    }
  }
}
