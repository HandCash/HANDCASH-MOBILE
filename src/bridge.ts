/**
 * Capacitor stand-in for Electron `window.handcash`.
 * BRC-100 presence: native localhost :3321 (see Brc100LocalBridgePlugin) + JS wiring.
 */

import {
  onNativeBrc100Request,
  respondNativeBrc100,
  startNativeBrc100Bridge,
  stopNativeBrc100Bridge,
} from './brc100LocalBridge'
import {
  nativeDeviceAuthClear,
  nativeDeviceAuthEnroll,
  nativeDeviceAuthStatus,
  nativeDeviceAuthUnlock,
} from './deviceAuthNative'

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

type UpdateStatus = {
  phase: 'idle' | 'not-available' | 'error'
  mode: 'none'
  currentVersion: string
  availableVersion: string | null
  percent: number | null
  error: string | null
  canInstall: boolean
}

const VERSION = '0.1.0-mobile'

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

function idleUpdate(): UpdateStatus {
  return {
    phase: 'not-available',
    mode: 'none',
    currentVersion: VERSION,
    availableVersion: null,
    percent: null,
    error: 'Updates are managed via sideload APK',
    canInstall: false,
  }
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

  const handcash = {
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
      bridgeStatus = httpUrl
        ? { online: true, httpsUrl: '', httpUrl, error: null }
        : {
            online: false,
            httpsUrl: '',
            httpUrl: '',
            error: 'Could not start local BRC-100 bridge',
          }
      injectWebViewWalletHint()
      emitBridge()
      return bridgeStatus
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
    focusWindow: async () => undefined,
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    getLogInfo: async () => ({ file: null, dir: null }),
    openLogs: async () => ({ ok: false as const, error: 'Logs are Desktop-only' }),
    uploadLogs: async () => ({ ok: false as const, error: 'Log upload is Desktop-only' }),
    startDeviceLink: async () => ({
      ok: false as const,
      error: 'Use embedded QR link on mobile',
    }),
    stopDeviceLink: async () => ({ ok: true as const }),
    storageGetSync: (key: string) => {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    storageSetSync: (key: string, value: string, _opts?: { allowVaultIdentityReplace?: boolean }) => {
      try {
        if (value === '') localStorage.removeItem(key)
        else localStorage.setItem(key, value)
        return true
      } catch {
        return false
      }
    },
    safeStorageAvailable: async () => {
      const status = await nativeDeviceAuthStatus()
      return status.available
    },
    deviceAuthStatus: () => nativeDeviceAuthStatus(),
    deviceAuthEnroll: (password: string) => nativeDeviceAuthEnroll(password),
    deviceAuthUnlock: (reason?: string) => nativeDeviceAuthUnlock(reason),
    deviceAuthClear: async () => {
      await nativeDeviceAuthClear()
      return { ok: true as const }
    },
    wipeWalletStorage: async () => {
      await nativeDeviceAuthClear()
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('handcash.brc100')) keys.push(k)
      }
      for (const k of keys) localStorage.removeItem(k)
      return { removed: keys.length }
    },
    clipboardWrite: async (text: string) => {
      await navigator.clipboard.writeText(text)
    },
    copyScreenshot: async () => ({
      ok: false as const,
      error: 'Screenshot copy is Desktop-only',
    }),
    onScreenshotCopied: () => () => undefined,
    getUpdateStatus: async () => idleUpdate(),
    checkForUpdates: async () => idleUpdate(),
    downloadUpdate: async () => idleUpdate(),
    setUpdateMode: async () => idleUpdate(),
    installUpdate: async () => undefined,
    onUpdateStatus: () => () => undefined,
  }

  Object.defineProperty(window, 'handcash', {
    value: handcash,
    writable: false,
    configurable: true,
  })

  // Native → JS BRC-100 requests (same path Desktop uses via Electron IPC).
  onNativeBrc100Request((native) => {
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
    bridgeStatus = httpUrl
      ? { online: true, httpsUrl: '', httpUrl, error: null }
      : {
          online: false,
          httpsUrl: '',
          httpUrl: '',
          error:
            platform === 'web'
              ? 'Native BRC-100 bridge requires the Android app'
              : 'Could not bind loopback :3321 (127.0.0.1 / ::1)',
        }
    injectWebViewWalletHint()
    emitBridge()
    if (bridgeStatus.online) {
      console.info('[brc100] bridge online', bridgeStatus.httpUrl, '(also ::1 for localhost)')
    } else {
      console.warn('[brc100] bridge offline', bridgeStatus.error)
    }
  })()
}
