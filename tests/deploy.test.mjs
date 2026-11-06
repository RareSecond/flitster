import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const publish = fileURLToPath(new URL('../deploy/publish.sh', import.meta.url))
const release = 'a'.repeat(40)

function runPublish(t, { fail = '', args = [release], host = 'example.invalid', archive = true } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'flitster-deploy-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  mkdirSync(join(cwd, 'bin'))
  mkdirSync(join(cwd, 'tmp'))
  if (archive) writeFileSync(join(cwd, 'flitster-release.tar.gz'), 'test archive')
  for (const command of ['ssh', 'scp', 'curl']) {
    writeFileSync(join(cwd, 'bin', command), `#!/bin/sh
set -eu
printf '%s\\n' '${command} '"$*" >> "$CALL_LOG"
if [ '${command}' != curl ]; then
  test -s "$2"
  printf '%s' "$2" > "$KEY_PATH"
fi
if [ "$FAIL_COMMAND" = '${command}' ]; then exit 1; fi
if [ "$FAIL_COMMAND" = activate ]; then
  case "$*" in *'mv /srv/apps/'*) exit 1 ;; esac
fi
`, { mode: 0o755 })
  }
  const result = spawnSync('bash', [publish, ...args], {
    cwd, encoding: 'utf8',
    env: {
      PATH: `${join(cwd, 'bin')}:/usr/bin:/bin`,
      TMPDIR: join(cwd, 'tmp'),
      CALL_LOG: join(cwd, 'calls'), KEY_PATH: join(cwd, 'key-path'),
      FAIL_COMMAND: fail,
      INFRA_SSH_HOST: host, INFRA_SSH_KEY: 'test-key', INFRA_SSH_KNOWN_HOSTS: 'test-host-key',
    },
  })
  const calls = existsSync(join(cwd, 'calls')) ? readFileSync(join(cwd, 'calls'), 'utf8') : ''
  if (existsSync(join(cwd, 'key-path'))) {
    assert.equal(existsSync(readFileSync(join(cwd, 'key-path'), 'utf8')), false, 'temporary key is removed')
  }
  return { ...result, calls }
}

test('release uploads before activation and checks public health with pinned SSH', t => {
  const result = runPublish(t)
  assert.equal(result.status, 0, result.stderr)
  const calls = result.calls.trim().split('\n')
  assert.deepEqual(calls.map(line => line.split(' ')[0]), ['ssh', 'scp', 'ssh', 'curl'])
  for (const line of calls.slice(0, 3)) {
    assert.match(line, /StrictHostKeyChecking=yes/)
    assert.match(line, /UserKnownHostsFile=/)
    assert.match(line, /root@example\.invalid/)
  }
  assert.match(calls[1], new RegExp(`${release}\\.tar\\.gz\\.part$`))
  assert.match(calls[2], new RegExp(`mv .* && /usr/local/sbin/flitster-release ${release}$`))
  assert.match(calls[3], /--fail .*https:\/\/flitster\.codictive\.be\/api\/health$/)
})

test('failed preflight, upload, activation or health check fails the deployment', async t => {
  for (const [fail, count] of [['ssh', 1], ['scp', 2], ['activate', 3], ['curl', 4]]) {
    await t.test(fail, t => {
      const result = runPublish(t, { fail })
      assert.equal(result.status, 1)
      assert.equal(result.calls.trim().split('\n').length, count)
    })
  }
})

test('invalid releases, missing credentials and missing archives fail before connecting', async t => {
  for (const options of [{ args: ['bad;command'] }, { args: [] }, { host: '' }, { archive: false }]) {
    await t.test(JSON.stringify(options), t => {
      const result = runPublish(t, options)
      assert.notEqual(result.status, 0)
      assert.equal(result.calls, '')
    })
  }
})
