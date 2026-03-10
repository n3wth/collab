import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

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
              cursorEl.style.borderColor = cursor.color

              // Avatar + thought container
              const container = document.createElement('span')
              container.className = `agent-cursor-head ${cursor.fading ? 'cursor-fading' : ''}`

              const avatar = document.createElement('span')
              avatar.className = 'agent-cursor-avatar'
              avatar.style.background = cursor.color
              avatar.textContent = cursor.name[0]
              container.appendChild(avatar)

              if (cursor.thought) {
                const thought = document.createElement('span')
                thought.className = 'agent-cursor-thought'
                thought.style.background = cursor.color
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
