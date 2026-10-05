import { nativeArchiveBrc39 } from './brc39ArchiveNative'
/**
 * Capacitor stand-in for Electron `window.handcash`.
 * BRC-100 presence: native localhost :3321 (see Brc100LocalBridgePlugin) + JS wiring.
 */

import {
  noteNativeBrc100PromptOpen,
  onNativeBrc100Request,
  respondNativeBrc100,
  startNativeBrc100Bridge,
  stopNativeBrc100Bridge,
} from './brc100LocalBridge'
import {
  nativeBringToFront,
  nativeDeviceAuthClear,
  nativeDeviceAuthEnroll,
  nativeDeviceAuthStatus,
  nativeDeviceAuthUnlock,
} from './deviceAuthNative'
import { nativeAppBrowserGuest, noteAppBrowserPromptOpen } from './appBrowserGuestNative'
import { nativeOpenSystemBrowser } from './systemBrowserNative'
import {
  checkMobileUpdates,
  downloadMobileUpdate,
  getMobileUpdateStatus,
  installMobileUpdate,
  onMobileUpdateStatus,
  setMobileUpdateMode,
  startMobileUpdateChecks,
  type UpdateStatus,
} from './mobileUpdate'
import { nativeDirectSessionApi } from './directSessionNative'
import { nativeSaveImageToGallery } from './saveImageNative'
import { nativeShareText } from './shareTextNative'
import { formatAppLogs, installAppLogCapture } from '@desktop/wallet/appLog'
import { shouldWipeHandcashKey } from '@desktop/wallet/wipePolicy'
import {
  durableStoreBridge,
  moveOriginStorageIntoNative,
  nativeDurableKeys,
  nativeDurableStore,
  type OriginMove,
} from './durableStoreNative'

type BridgeStatus = {
  online: boolean
  httpsUrl: string
  httpUrl: string
  error: string | null
}

type HttpRequestEvent = {
  method: string
  path: string
  headers: Record<string, string>
  body: string
  request_id: number
}

type HttpResponseEvent = {
  request_id: number
  status: number
  body: string
}

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

let bridgeStatus: BridgeStatus = {
  online: false,
  httpsUrl: '',
  httpUrl: '',
  error: 'Starting BRC-100 bridge…',
}

const bridgeListeners = new Set<(status: BridgeStatus) => void>()
const httpListeners = new Set<(event: HttpRequestEvent) => void>()

function emitBridge() {
  for (const l of bridgeListeners) l(bridgeStatus)
}

/** Apply start/restart result: online when httpUrl is set, else offline with error. */
function applyBridgeHttpUrl(httpUrl: string | null, offlineError: string): BridgeStatus {
  bridgeStatus = httpUrl
    ? { online: true, httpsUrl: '', httpUrl, error: null }
    : { online: false, httpsUrl: '', httpUrl: '', error: offlineError }
  injectWebViewWalletHint()
  emitBridge()
  return bridgeStatus
}

function detectPlatform(): string {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('android')) return 'android'
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios'
  return 'web'
}

/** Advertise wallet presence to pages running inside this WebView. */
function injectWebViewWalletHint(): void {
  try {
    ;(window as unknown as { __HANDCASH_BRC100__?: boolean }).__HANDCASH_BRC100__ = true
    ;(window as unknown as { handcashBrc100?: { present: boolean; httpUrl: string } }).handcashBrc100 =
      {
        present: bridgeStatus.online,
        httpUrl: bridgeStatus.httpUrl || 'http://127.0.0.1:3321',
      }
  } catch {
    // ignore
  }
}

export function installMobileBridge(): void {
  if (window.handcash) return

  const platform = detectPlatform()
  const durable = nativeDurableStore()
  let originMove: OriginMove | null = null
  let originMoveMs = 0
  if (durable) {
    const moveStartedAt = Date.now()
    try {
      originMove = moveOriginStorageIntoNative(durable, localStorage)
      originMoveMs = Date.now() - moveStartedAt
    } catch (err) {
      console.warn('[durable] could not move WebView storage into the file store', err)
    }
  }

  const handcash = {
    ...nativeArchiveBrc39,
    platform,
    getAppInfo: async () => ({
      version: VERSION,
      name: 'HandCash Mobile',
      isPackaged: true,
      platform,
    }),
    getBridgeStatus: async () => bridgeStatus,
    restartBridge: async () => {
      await stopNativeBrc100Bridge()
      const httpUrl = await startNativeBrc100Bridge()
      return applyBridgeHttpUrl(httpUrl, 'Could not start local BRC-100 bridge')
    },
    onBridgeStatus: (handler: (status: BridgeStatus) => void) => {
      bridgeListeners.add(handler)
      handler(bridgeStatus)
      return () => {
        bridgeListeners.delete(handler)
      }
    },
    onHttpRequest: (handler: (event: HttpRequestEvent) => void) => {
      httpListeners.add(handler)
      return () => {
        httpListeners.delete(handler)
      }
    },
    onHttpRequestCancelled: () => () => undefined,
    respondHttp: (response: HttpResponseEvent) => {
      void respondNativeBrc100({
        requestId: response.request_id,
        status: response.status,
        body: response.body,
      })
    },
    notePromptOpen: (open: boolean, requestId?: number) => {
      void noteNativeBrc100PromptOpen(open, requestId)
      noteAppBrowserPromptOpen(open)
    },
    focusWindow: async () => {
      await nativeBringToFront()
    },
    // Must leave the app, like Desktop's shell.openExternal. `window.open`
    // from this WebView is not a handoff — Android may swallow it or render
    // the page in a wallet-owned surface Desktop has no equivalent of.
    openExternal: async (url: string) => {
      const opened = await nativeOpenSystemBrowser(url)
      if (opened.ok) return
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    // The core's browser panel draws app tabs through a native WebView laid
    // over it, as Desktop does with `<webview>`. `openExternal` is Chrome.
    appBrowserGuest: nativeAppBrowserGuest(),
    getLogInfo: async () => ({ file: null, dir: null }),
    openLogs: async () => ({ ok: false as const, error: 'Finder reveal is Desktop-only' }),
    readLogs: async () => {
      const text = formatAppLogs()
      return {
        ok: true as const,
        text,
        bytes: text.length,
        truncated: false,
      }
    },
    uploadLogs: async () => ({ ok: false as const, error: 'Log upload is Desktop-only' }),
    startDeviceLink: async () => ({
      ok: false as const,
      error: 'Use embedded QR link on mobile',
    }),
    stopDeviceLink: async () => ({ ok: true as const }),
    // Only when the native file store is really there. Answering these without
    // one made the core treat this shell as the owner of a file store: every
    // write reported success, values over the small-key mirror cap reached no
    // store at all, and Activity, chat and inventory reset on relaunch.
    ...(durable ? durableStoreBridge(durable) : {}),
    safeStorageAvailable: async () => {
      const status = await nativeDeviceAuthStatus()
      return status.available
    },
    deviceAuthStatus: () => nativeDeviceAuthStatus(),
    deviceAuthEnroll: (secret: string) => nativeDeviceAuthEnroll(secret),
    deviceAuthUnlock: (reason?: string) => nativeDeviceAuthUnlock(reason),
    deviceAuthClear: async () => {
      await nativeDeviceAuthClear()
      return { ok: true as const }
    },
    wipeWalletStorage: async () => {
      await nativeDeviceAuthClear()
      const keys = new Set<string>()
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && shouldWipeHandcashKey(k)) keys.add(k)
      }
      for (const k of keys) localStorage.removeItem(k)
      if (durable) {
        for (const k of nativeDurableKeys(durable)) {
          if (!shouldWipeHandcashKey(k)) continue
          durable.remove(k)
          keys.add(k)
        }
      }
      return { removed: keys.size }
    },
    clipboardWrite: async (text: string) => {
      await navigator.clipboard.writeText(text)
    },
    shareText: (payload: { title: string; text: string }) => nativeShareText(payload),
    saveImageFile: async (payload: { filename: string; mime: string; base64: string }) => {
      const result = await nativeSaveImageToGallery(payload)
      if (!result.ok) return { ok: false as const, error: result.error }
      return { ok: true as const, path: result.path }
    },
    copyScreenshot: async () => ({
      ok: false as const,
      error: 'Screenshot copy is Desktop-only',
    }),
    onScreenshotCopied: () => () => undefined,
    getUpdateStatus: async () => getMobileUpdateStatus(),
    checkForUpdates: async () => checkMobileUpdates({ reason: 'manual' }),
    downloadUpdate: async () => downloadMobileUpdate(),
    setUpdateMode: async (mode: 'default' | 'manual' | 'none') => setMobileUpdateMode(mode),
    installUpdate: async () => installMobileUpdate(),
    onUpdateStatus: (handler: (status: UpdateStatus) => void) => onMobileUpdateStatus(handler),
    ...nativeDirectSessionApi(),
  }

  Object.defineProperty(window, 'handcash', {
    value: handcash,
    writable: false,
    configurable: true,
  })

  installAppLogCapture()
  if (!durable) {
    console.warn('[durable] native file store missing — wallet state stays in WebView storage (≈5MB)')
  } else if (originMove) {
    console.info(
      `[durable] origin move done ${originMoveMs}ms — ${originMove.moved} key(s) (${Math.round(originMove.movedBytes / 1024)}KB) into the app file store · freed ${Math.round(originMove.freedBytes / 1024)}KB of WebView storage`,
    )
    if (originMove.recovered > 0 || originMove.droppedQueues > 0) {
      console.info(
        `[durable] recovered ${originMove.recovered} key(s) the file store held stale · dropped ${originMove.droppedQueues} drained queue(s)`,
      )
    }
  }

  // Native → JS BRC-100 requests (same path Desktop uses via Electron IPC).
  onNativeBrc100Request((native) => {
    if (typeof native.receivedAtMs === 'number') {
      const ms = Date.now() - native.receivedAtMs
      if (ms >= 250) console.info(`[spend] bridge_deliver done ${ms}ms`)
    }
    const event: HttpRequestEvent = {
      method: native.method,
      path: native.path,
      headers: native.headers ?? {},
      body: native.body ?? '',
      request_id: native.requestId,
    }
    for (const l of httpListeners) l(event)
  })

  void (async () => {
    const httpUrl = await startNativeBrc100Bridge()
    applyBridgeHttpUrl(
      httpUrl,
      platform === 'web'
        ? 'Native BRC-100 bridge requires the Android app'
        : 'Could not bind loopback :3321 (127.0.0.1 / ::1)',
    )
    if (bridgeStatus.online) {
      console.info('[brc100] bridge online', bridgeStatus.httpUrl, '(also ::1 for localhost)')
    } else {
      console.warn('[brc100] bridge offline', bridgeStatus.error)
    }
    startMobileUpdateChecks()
  })()
}
