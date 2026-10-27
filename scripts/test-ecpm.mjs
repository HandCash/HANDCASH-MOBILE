import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const desktop = fileURLToPath(new URL('../../HANDCASH-DESKTOP/', import.meta.url))
const pin = JSON.parse(readFileSync(new URL('../ui-core-source.json', import.meta.url), 'utf8'))
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: desktop, encoding: 'utf8' }).trim(), pin.gitSha)
assert.equal(JSON.parse(readFileSync(`${desktop}/package.json`, 'utf8')).version, pin.version)
// Run the actual shared dispatch/consent/crypto contract, never a Mobile fork.
const core = spawnSync('npm', ['run', 'test:ecpm'], { cwd: desktop, stdio: 'inherit' })
assert.equal(core.status, 0, 'Pinned Desktop ECPM contract failed')
const relay = spawnSync(process.execPath, ['--test', '--experimental-strip-types', 'src/appBrowserBridgeShim.test.ts'], { cwd: root, stdio: 'inherit' })
assert.equal(relay.status, 0, 'Mobile app-tab ECPM relay failed')
console.log(`Mobile ECPM verified against Desktop ${pin.gitSha}`)
