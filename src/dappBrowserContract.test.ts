import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = readFileSync(resolve(root, 'native-android/DappBrowserPlugin.java'), 'utf8')
const activity = readFileSync(resolve(root, 'native-android/DappBrowserActivity.java'), 'utf8')
const patcher = readFileSync(resolve(root, 'scripts/patch-android.mjs'), 'utf8')
const systemBrowser = readFileSync(
  resolve(root, 'native-android/SystemBrowserPlugin.java'),
  'utf8',
)
const mainActivity = readFileSync(resolve(root, 'native-android/MainActivity.java'), 'utf8')
const update = readFileSync(resolve(root, 'src/mobileUpdate.ts'), 'utf8')
const bridge = readFileSync(resolve(root, 'src/bridge.ts'), 'utf8')

test('Open in-app is structurally bound to the retained wallet browser', () => {
  assert.match(plugin, /new Intent\(getContext\(\), DappBrowserActivity\.class\)/)
  assert.doesNotMatch(plugin, /Intent\.ACTION_VIEW/)
  assert.match(plugin, /FLAG_ACTIVITY_REORDER_TO_FRONT/)
  assert.match(patcher, /android:launchMode="singleTask"/)
  assert.match(patcher, /android:screenOrientation="portrait"/)
  assert.match(
    activity,
    /setRequestedOrientation\(ActivityInfo\.SCREEN_ORIENTATION_PORTRAIT\)/,
  )
})

test('Open in browser leaves the app through the OS, like Desktop', () => {
  assert.match(systemBrowser, /Intent\.ACTION_VIEW/)
  assert.match(systemBrowser, /FLAG_ACTIVITY_NEW_TASK/)
  // The OS handoff must never reach a wallet-owned WebView.
  assert.doesNotMatch(systemBrowser, /DappBrowserActivity/)
  assert.match(mainActivity, /registerPlugin\(SystemBrowserPlugin\.class\)/)
  assert.match(bridge, /openExternal[\s\S]{0,200}nativeOpenSystemBrowser/)
})

test('APK updates go to the OS download manager, not the in-app browser', () => {
  assert.match(update, /nativeOpenSystemBrowser\(release\.apkUrl\)/)
  assert.doesNotMatch(update, /nativeOpenDappBrowser/)
  // A download URL must never become the page the app browser resumes to.
  assert.match(activity, /isDownloadUrl/)
  assert.match(activity, /!isDownloadUrl\(url\)/)
})

test('the retained browser preserves its page and returns after wallet requests', () => {
  assert.match(activity, /PREF_URL/)
  assert.match(activity, /sameOrigin\(liveUrl, requestedUrl\)/)
  assert.match(activity, /if \(resumeBrowser && !browserInForeground\) bringBrowserForward\(\)/)
  assert.match(activity, /wallet\.setOnClickListener\(v -> bringWalletForward\(\)\)/)
  assert.doesNotMatch(activity, /close\.setOnClickListener\(v -> finish\(\)\)/)
})
