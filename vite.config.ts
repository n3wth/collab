import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const IMAGE_MODEL = 'gemini-3.1-flash-image-preview'
const IMAGE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const geminiKey = env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY

  return {
    plugins: [
      react(),
      {
        name: 'gemini-image-proxy',
        configureServer(server) {
          server.middlewares.use('/api/gemini-image', async (req, res) => {
            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Method not allowed' }))
              return
            }

            const clientKey = req.headers['x-gemini-key'] as string | undefined
            const apiKey = geminiKey || clientKey
            if (!apiKey) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'No API key' }))
              return
            }

            // Read request body
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(chunk as Buffer)
            let prompt: string
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString())
              prompt = body.prompt
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid JSON body' }))
              return
            }

            try {
              const apiRes = await fetch(`${IMAGE_API_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    temperature: 0.7,
                  },
                  safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
                  ],
                }),
              })

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const data: any = await apiRes.json()

              if (!apiRes.ok) {
                res.writeHead(apiRes.status, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                  error: data?.error?.message || 'API error',
                  code: data?.error?.code || apiRes.status,
                  status: apiRes.status,
                }))
                return
              }

              const parts = data?.candidates?.[0]?.content?.parts || []
              let imageData: string | null = null
              let mimeType = 'image/png'
              let caption: string | undefined

              for (const part of parts) {
                if (part.inlineData) {
                  imageData = part.inlineData.data
                  mimeType = part.inlineData.mimeType || 'image/png'
                } else if (part.text) {
                  caption = part.text.trim()
                }
              }

              if (!imageData) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'No image data in response' }))
                return
              }

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ imageData, mimeType, caption }))
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Proxy request failed', detail: String(err) }))
            }
          })
        },
      },
    ],
    server: {
      proxy: {
        '/api/gemini': {
          target: 'https://generativelanguage.googleapis.com',
          changeOrigin: true,
          rewrite: () => `/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-tiptap': ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/extension-placeholder'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-shaders': ['@paper-design/shaders-react'],
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'node',
    },
  }
})
