import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { serve } from 'srvx/node'
import { staticMiddleware } from 'srvx/static'
import start from '../dist/server/server.js'

const publicDir = fileURLToPath(new URL('../dist/client/', import.meta.url))
const shell = await readFile(new URL('../dist/client/_shell.html', import.meta.url))

serve({
  port: Number(process.env.PORT || 3000),
  hostname: process.env.HOST || '0.0.0.0',
  middleware: [staticMiddleware({ dir: publicDir, maxAge: 0 })],
  fetch(request) {
    const { pathname } = new URL(request.url)
    // Only data actions/API requests need the Start server runtime.
    if (pathname.startsWith('/_serverFn/') || pathname.startsWith('/api/')) {
      return start.fetch(request)
    }
    if (['GET', 'HEAD'].includes(request.method) && !pathname.includes('.')) {
      return new Response(request.method === 'HEAD' ? null : shell, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
      })
    }
    return new Response('Not found', { status: 404 })
  },
})
