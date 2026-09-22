import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = readFileSync(resolve(root, 'native-android/DappBrowserPlugin.java'), 'utf8')
const activity = readFileSync(resolve(root, 'native-android/DappBrowserActivity.java'), 'utf8')
const patcher = readFileSync(resolve(root, 'scripts/patch-android.mjs'), 'utf8')

test('Open in-app is structurally bound to the retained wallet browser', () => {
  assert.match(plugin, /new Intent\(getContext\(\), DappBrowserActivity\.class\)/)
  assert.doesNotMatch(plugin, /Intent\.ACTION_VIEW/)
  assert.match(plugin, /FLAG_ACTIVITY_REORDER_TO_FRONT/)
  assert.match(patcher, /android:launchMode="singleTask"/)
})

test('the retained browser preserves its page and returns after wallet requests', () => {
  assert.match(activity, /PREF_URL/)
  assert.match(activity, /sameOrigin\(liveUrl, requestedUrl\)/)
  assert.match(activity, /if \(resumeBrowser && !browserInForeground\) bringBrowserForward\(\)/)
  assert.match(activity, /wallet\.setOnClickListener\(v -> bringWalletForward\(\)\)/)
  assert.doesNotMatch(activity, /close\.setOnClickListener\(v -> finish\(\)\)/)
})
