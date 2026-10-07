import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const guest = read('native-android/AppBrowserGuestPlugin.java')
const patcher = read('scripts/patch-android.mjs')
const systemBrowser = read('native-android/SystemBrowserPlugin.java')
const mainActivity = read('native-android/MainActivity.java')
const update = read('src/mobileUpdate.ts')
const bridge = read('src/bridge.ts')
const bridgePlugin = read('native-android/Brc100LocalBridgePlugin.java')
const guestNative = read('src/appBrowserGuestNative.ts')

test('the separate in-app browser activity is gone', () => {
  assert.equal(existsSync(resolve(root, 'native-android/DappBrowserActivity.java')), false)
  assert.equal(existsSync(resolve(root, 'native-android/DappBrowserPlugin.java')), false)
  assert.doesNotMatch(mainActivity, /DappBrowserPlugin/)
  assert.doesNotMatch(bridge, /openAppBrowser|DappBrowser/)
  // Old installs keep their android/ tree: strip the manifest entry and the copies.
  assert.match(patcher, /\.DappBrowserActivity/)
  assert.match(patcher, /RETIRED_NATIVE = \['DappBrowserActivity\.java', 'DappBrowserPlugin\.java'\]/)
})

test('app tabs are guests of the core browser panel', () => {
  assert.match(mainActivity, /registerPlugin\(AppBrowserGuestPlugin\.class\)/)
  assert.match(bridge, /appBrowserGuest: nativeAppBrowserGuest\(\)/)
  assert.match(bridge, /notePromptOpen[\s\S]{0,200}noteAppBrowserPromptOpen\(open\)/)
})

test('a guest page carries no wallet interface, only the origin-vouched bridge channel', () => {
  assert.doesNotMatch(guest, /addJavascriptInterface|evaluateJavascript/)
  assert.doesNotMatch(guest, /ReactNativeWebView|HandCashRnWallet|127\.0\.0\.1:3321/)
  // One listener, and the origin is the WebView's, never the message's.
  assert.equal(guest.match(/addWebMessageListener\(/g)?.length, 1)
  assert.match(guest, /dispatchInApp\(method, path, body, sourceOrigin\.toString\(\), reply\)/)
  assert.doesNotMatch(guest, /optString\("origin"|getString\("origin"/)
  assert.match(bridgePlugin, /headers\.put\("origin", origin\);[\s\S]{0,400}event\.put\("channel", "in-app"\)/)
  assert.match(bridge, /native\.channel === 'in-app' \? \{ channel: 'in-app' as const \}/)
  assert.match(guestNative, /bridgeShim: APP_BROWSER_BRIDGE_SHIM/)
  assert.match(guest, /setAllowFileAccess\(false\)/)
  assert.match(guest, /setAllowContentAccess\(false\)/)
  assert.match(guest, /MIXED_CONTENT_NEVER_ALLOW/)
})

test('a guest never loads the wallet origin or plaintext off loopback', () => {
  assert.match(guest, /walletOrigin = host\.equals\("localhost"\)/)
  assert.match(guest, /scheme\.equals\("http"\) && loopback/)
  assert.match(guest, /if \(loadable\(target\.toString\(\)\) != null\) return false/)
})

test('no page can sit over a permission prompt', () => {
  assert.match(guest, /boolean show = guest\.wantsVisible && !promptOpen/)
  // Hidden guests move off screen so an app mid-flow keeps running.
  assert.match(guest, /setTranslationX\(show \? 0f : OFFSCREEN\)/)
})

test('Open in browser leaves the app through the OS, like Desktop', () => {
  assert.match(systemBrowser, /Intent\.ACTION_VIEW/)
  assert.match(systemBrowser, /FLAG_ACTIVITY_NEW_TASK/)
  assert.match(mainActivity, /registerPlugin\(SystemBrowserPlugin\.class\)/)
  assert.match(bridge, /openExternal[\s\S]{0,200}nativeOpenSystemBrowser/)
})

test('APK updates go to the OS download manager, not an app tab', () => {
  assert.match(update, /nativeOpenSystemBrowser\(release\.apkUrl\)/)
})
