import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const script = readFileSync(new URL('../scripts/build-apk.sh', import.meta.url), 'utf8')

test('APK checks release signing before provisioning or replacing dependencies', () => {
  const guard = script.indexOf('if [[ "${HANDCASH_BUILD_TYPE:-release}" != "debug" ]]')
  assert.ok(guard > script.indexOf('node "$ROOT/scripts/assert-ui-core.mjs"'))
  for (const name of ['KEYSTORE', 'STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD', 'CERT_SHA256']) {
    const check = script.indexOf(`HANDCASH_ANDROID_${name}:?`)
    assert.ok(check > guard, `${name} must be required for release`)
    for (const step of ['JDK_ROOT=', 'curl -fsSL', 'npm ci', 'npm run build']) {
      assert.ok(check < script.indexOf(step), `${name} must precede ${step}`)
    }
  }
})

test('APK rejects a dirty shared core before provisioning or replacing dependencies', () => {
  const preflight = script.indexOf('node "$ROOT/scripts/assert-ui-core.mjs"')
  assert.ok(preflight >= 0)
  for (const step of ['JDK_ROOT=', 'curl -fsSL', 'npm ci', 'npm run build']) {
    assert.ok(preflight < script.indexOf(step), `core preflight must precede ${step}`)
  }
})
