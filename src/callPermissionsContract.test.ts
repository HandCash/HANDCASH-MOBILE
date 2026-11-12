import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const patcher = readFileSync(resolve(root, 'scripts/patch-android.mjs'), 'utf8')

test('calls: the manifest declares every permission the WebView asks for a mic or camera', () => {
  for (const permission of ['CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS']) {
    assert.match(patcher, new RegExp(`uses-permission android:name="android\\.permission\\.${permission}"`))
  }
})
