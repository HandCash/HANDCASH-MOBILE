/**
 * Capacitor / browser stand-in for Electron `window.handcash`.
 * Durable prefs use localStorage (same fallback Desktop uses without Electron).
 */

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

function idleUpdate(): UpdateStatus {
  return {
    phase: 'not-available',
    mode: 'none',
    currentVersion: VERSION,
    availableVersion: null,
    percent: null,
    error: 'Updates are managed via the app store / sideload APK',
    canInstall: false,
  }
}

function detectPlatform(): string {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('android')) return 'android'
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios'
  return 'web'
}

export function installMobileBridge(): void {
  if (window.handcash) return

  const platform = detectPlatform()

  const handcash = {
    platform,
    getAppInfo: async () => ({
      version: VERSION,
      name: 'HandCash',
      isPackaged: true,
      platform,
    }),
    getBridgeStatus: async () => ({
      online: false,
      httpsUrl: '',
      httpUrl: '',
      error: 'BRC-100 local bridge is Desktop-only in this build',
    }),
    restartBridge: async () => handcash.getBridgeStatus(),
    onBridgeStatus: () => () => undefined,
    onHttpRequest: () => () => undefined,
    onHttpRequestCancelled: () => () => undefined,
    respondHttp: () => undefined,
    focusWindow: async () => undefined,
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    getLogInfo: async () => ({ file: null, dir: null }),
    openLogs: async () => ({ ok: false as const, error: 'Logs are Desktop-only' }),
    uploadLogs: async () => ({ ok: false as const, error: 'Log upload is Desktop-only' }),
    startDeviceLink: async () => ({
      ok: false as const,
      error: 'Embedded QR link does not need a LAN host on mobile',
    }),
    stopDeviceLink: async () => ({ ok: true as const }),
    storageGetSync: (key: string) => {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    storageSetSync: (key: string, value: string) => {
      try {
        if (value === '') localStorage.removeItem(key)
        else localStorage.setItem(key, value)
        return true
      } catch {
        return false
      }
    },
    safeStorageAvailable: async () => false,
    wipeWalletStorage: async () => {
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
}
