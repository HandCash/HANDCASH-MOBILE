import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const script = readFileSync(new URL('../scripts/build-apk.sh', import.meta.url), 'utf8')

test('APK rejects a dirty shared core before provisioning or replacing dependencies', () => {
  const preflight = script.indexOf('node "$ROOT/scripts/assert-ui-core.mjs"')
  assert.ok(preflight >= 0)
  for (const step of ['JDK_ROOT=', 'curl -fsSL', 'npm ci', 'npm run build']) {
    assert.ok(preflight < script.indexOf(step), `core preflight must precede ${step}`)
  }
})
