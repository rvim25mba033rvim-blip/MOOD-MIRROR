import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { requestChatCompletion } from './server/chatProxy.js'

const readJsonBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('Invalid JSON body.')
  }
}

const writeJson = (res, statusCode, body) => {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

const localChatApiPlugin = () => ({
  name: 'local-chat-api-proxy',
  configureServer(server) {
    server.middlewares.use('/api/chat', async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.end()
        return
      }

      if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'Method not allowed' })
        return
      }

      try {
        const body = await readJsonBody(req)
        const result = await requestChatCompletion(body)
        writeJson(res, 200, result)
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500
        writeJson(res, status, {
          error: status >= 500 ? 'Secure chat proxy failed. Check server AI env vars.' : error.message
        })
      }
    })
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/chat', async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.end()
        return
      }

      if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'Method not allowed' })
        return
      }

      try {
        const body = await readJsonBody(req)
        const result = await requestChatCompletion(body)
        writeJson(res, 200, result)
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500
        writeJson(res, status, {
          error: status >= 500 ? 'Secure chat proxy failed. Check server AI env vars.' : error.message
        })
      }
    })
  }
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localChatApiPlugin()],
})
