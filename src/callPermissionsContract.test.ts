import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const patcher = readFileSync(resolve(root, 'scripts/patch-android.mjs'), 'utf8')
// Exercise the production transform without running signing or native-file writes.
const manifestTransform = patcher.slice(patcher.indexOf('function patchManifest('), patcher.indexOf('\nfunction patchGradle('))
const patchManifest = runInNewContext(`${manifestTransform}; patchManifest`, { FGS_SUBTYPE: 'test' }) as (src: string) => string

for (const camera of ['', '<uses-permission android:name="android.permission.CAMERA" />']) {
  test(`calls: generated manifest has mic permissions exactly once (${camera ? 'existing camera' : 'fresh shell'})`, () => {
    const manifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">${camera}<application android:allowBackup="true"><activity android:launchMode="singleTask"></activity></application></manifest>`
    const patched = patchManifest(manifest)
    for (const permission of ['CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS']) {
      assert.equal(patched.split(`<uses-permission android:name="android.permission.${permission}" />`).length - 1, 1)
    }
    assert.equal(patchManifest(patched), patched, 'repeated sync must not duplicate permissions')
  })
}

test('calls: the manifest declares every permission the WebView asks for a mic or camera', () => {
  for (const permission of ['CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS']) {
    assert.match(patcher, new RegExp(`uses-permission android:name="android\\.permission\\.${permission}"`))
  }
})
