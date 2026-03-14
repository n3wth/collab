import { WebSocketServer } from 'ws'
import { setupWSConnection } from 'y-websocket/bin/utils'

const port = Number(process.env.PORT) || 1234
const wss = new WebSocketServer({ port })

wss.on('connection', (ws, req) => {
  setupWSConnection(ws, req)
})

console.log(`y-websocket server running on port ${port}`)
