import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:1234'

export function createYjsProvider(sessionId: string) {
  const ydoc = new Y.Doc()
  const provider = new WebsocketProvider(WS_URL, `collab-${sessionId}`, ydoc)
  return { ydoc, provider }
}
