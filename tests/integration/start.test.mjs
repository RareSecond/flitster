import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

const root = new URL('../../', import.meta.url)
const shell = await readFile(new URL('dist/client/_shell.html', root), 'utf8')
const server = spawn(process.execPath, ['server/serve.mjs'], {
  cwd: fileURLToPath(root),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
after(async () => {
  if (server.exitCode !== null) return
  const exited = once(server, 'exit')
  server.kill('SIGTERM')
  await exited
})

const origin = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Production server did not start')), 10_000)
  let output = ''
  const onData = (chunk) => {
    output += chunk
    const match = output.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/)
    if (match) {
      clearTimeout(timer)
      resolve(`http://127.0.0.1:${match[1]}`)
    }
  }
  server.stdout.on('data', onData)
  server.stderr.on('data', onData)
  server.once('error', reject)
  server.once('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`Production server exited (${code}): ${output}`))
  })
})

test('all screens and Spotify callbacks receive the static client shell', async () => {
  for (const path of ['/', '/deck', '/playlists', '/?code=test-callback', '/missing-page']) {
    const response = await fetch(`${origin}${path}`)
    assert.equal(response.status, 200, path)
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.equal(await response.text(), shell, path)
  }
  const head = await fetch(`${origin}/deck`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
})

test('PWA precache includes the shell and every entry is served', async () => {
  const response = await fetch(`${origin}/sw.js`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /javascript/)
  const worker = await response.text()
  const urls = [...worker.matchAll(/url:"([^"]+)"/g)].map((match) => match[1])
  assert.ok(urls.includes('_shell.html'))
  assert.ok(urls.some((url) => url.includes('_app.deck')))
  assert.ok(urls.some((url) => url.includes('_app.playlists')))
  for (const url of urls) {
    const asset = await fetch(new URL(url, `${origin}/`))
    assert.equal(asset.status, 200, url)
    assert.ok((await asset.arrayBuffer()).byteLength > 0, url)
  }
  const manifest = await (await fetch(`${origin}/manifest.webmanifest`)).json()
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.name, 'Flitster')
})

test('missing assets and API requests never fall back to the SPA document', async () => {
  for (const path of ['/missing.js', '/api/missing']) {
    const response = await fetch(`${origin}${path}`)
    assert.equal(response.status, 404)
    assert.notEqual(await response.text(), shell)
  }
  const response = await fetch(`${origin}/deck`, { method: 'POST' })
  assert.equal(response.status, 404)
})
