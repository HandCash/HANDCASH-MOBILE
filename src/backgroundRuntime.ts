import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import {
  ForegroundService,
  Importance,
} from '@capawesome-team/capacitor-android-foreground-service'
import { LocalNotifications } from '@capacitor/local-notifications'
import { appendAppLog } from '@desktop/wallet/appLog'
import { appDisplayName } from '@desktop/wallet/appIdentity'
import { nativeBringToFront } from './deviceAuthNative'

const SYNC_CHANNEL = 'handcash-sync'
// Android channels are immutable after first creation. Version the IDs when
// changing sound / importance so an old silent or disabled channel cannot
// keep overriding the app's corrected defaults.
const RECEIVE_CHANNEL = 'handcash-receive-v2'
const PERMISSION_CHANNEL = 'handcash-permission-v2'
const UPDATE_CHANNEL = 'handcash-update-v2'
const FOREGROUND_NOTIFICATION_ID = 15301
const PERMISSION_NOTIFICATION_ID = 15302
const UPDATE_NOTIFICATION_ID = 15303

let appActive = true
let foregroundRunning = false
let notificationsReady = false
let notificationsSetup: Promise<boolean> | null = null
let lastNotifiedUpdateVersion: string | null = null
let nextNotificationId = Math.floor(Date.now() % 1_900_000_000)

function allocateNotificationId(): number {
  nextNotificationId = (nextNotificationId + 1) % 1_900_000_000
  return Math.max(1, nextNotificationId)
}

async function setupNotifications(): Promise<boolean> {
  if (notificationsReady) return true
  try {
    const current = await LocalNotifications.checkPermissions()
    const permission =
      current.display === 'granted'
        ? current
        : await LocalNotifications.requestPermissions()
    if (permission.display !== 'granted') {
      appendAppLog('warn', '[mobile-notifications] display permission denied')
      return false
    }
    await LocalNotifications.createChannel({
      id: RECEIVE_CHANNEL,
      name: 'Wallet activity',
      description: 'Payments, collectables, and wallet activity',
      importance: 4,
      visibility: 1,
      vibration: true,
      sound: 'default',
    })
    await LocalNotifications.createChannel({
      id: PERMISSION_CHANNEL,
      name: 'Permission requests',
      description: 'Apps requesting wallet access or payments',
      importance: 5,
      visibility: 1,
      vibration: true,
      sound: 'default',
    })
    await LocalNotifications.createChannel({
      id: UPDATE_CHANNEL,
      name: 'App updates',
      description: 'New HandCash Mobile beta builds',
      importance: 4,
      visibility: 1,
      vibration: true,
      sound: 'default',
    })
    notificationsReady = true
    return true
  } catch (err) {
    appendAppLog(
      'warn',
      `[mobile-notifications] setup failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}

async function ensureNotifications(): Promise<boolean> {
  if (notificationsReady) return true
  if (!notificationsSetup) {
    notificationsSetup = setupNotifications().finally(() => {
      notificationsSetup = null
    })
  }
  return notificationsSetup
}

function runNotification(label: string, task: () => Promise<void>): void {
  void task().catch((err) => {
    appendAppLog(
      'warn',
      `[mobile-notifications] ${label} failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  })
}

async function startForegroundSync(): Promise<void> {
  if (foregroundRunning || !Capacitor.isNativePlatform()) return
  try {
    const permission = await ForegroundService.requestPermissions()
    if (permission.display !== 'granted') {
      appendAppLog('warn', '[mobile-sync] foreground notification permission denied')
      return
    }
    await ForegroundService.createNotificationChannel({
      id: SYNC_CHANNEL,
      name: 'Wallet sync',
      description: 'Keeps the unlocked wallet current while HandCash is in the background',
      importance: Importance.Low,
    })
    await ForegroundService.startForegroundService({
      id: FOREGROUND_NOTIFICATION_ID,
      title: 'HandCash',
      body: 'Wallet sync active',
      smallIcon: 'ic_stat_handcash',
      silent: true,
      notificationChannelId: SYNC_CHANNEL,
    })
    foregroundRunning = true
    appendAppLog('info', '[mobile-sync] foreground service started')
  } catch (err) {
    appendAppLog(
      'warn',
      `[mobile-sync] foreground service failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function stopForegroundSync(): Promise<void> {
  if (!foregroundRunning) return
  try {
    await ForegroundService.stopForegroundService()
  } catch {
    // The native service may already have been reclaimed.
  } finally {
    foregroundRunning = false
  }
}

async function dismissPermissionNotification(): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id: PERMISSION_NOTIFICATION_ID }] })
  } catch {
    // ignore
  }
}

async function scheduleLocal(opts: {
  id: number
  title: string
  body: string
  channelId: string
  extra?: Record<string, unknown>
}): Promise<void> {
  const result = await LocalNotifications.schedule({
    notifications: [
      {
        id: opts.id,
        title: opts.title,
        body: opts.body,
        channelId: opts.channelId,
        smallIcon: 'ic_stat_handcash',
        autoCancel: true,
        ongoing: false,
        ...(opts.extra ? { extra: opts.extra } : {}),
      },
    ],
  })
  appendAppLog(
    'info',
    `[mobile-notifications] posted channel=${opts.channelId} id=${
      result.notifications[0]?.id ?? opts.id
    }`,
  )
}

async function notifyReceive(detail: { title?: string; body?: string }): Promise<void> {
  if (appActive || !(await ensureNotifications())) return
  await scheduleLocal({
    id: allocateNotificationId(),
    title: detail.title?.trim() || 'Wallet updated',
    body: detail.body?.trim() || 'New wallet activity is available',
    channelId: RECEIVE_CHANNEL,
    extra: { kind: 'receive' },
  })
}

async function notifySpend(detail: {
  title?: string
  body?: string
  txid?: string
  method?: string
}): Promise<void> {
  if (appActive || !(await ensureNotifications())) return
  await scheduleLocal({
    id: allocateNotificationId(),
    title: detail.title?.trim() || 'Payment sent',
    body: detail.body?.trim() || 'Your wallet has been updated',
    channelId: RECEIVE_CHANNEL,
    extra: {
      kind: 'spend',
      txid: detail.txid ?? null,
      method: detail.method ?? null,
    },
  })
}

async function notifyUpdateAvailable(detail: {
  version?: string
  releaseUrl?: string | null
}): Promise<void> {
  const version = detail.version?.trim()
  if (!version || version === lastNotifiedUpdateVersion) return
  if (!(await ensureNotifications())) return
  lastNotifiedUpdateVersion = version
  await scheduleLocal({
    id: UPDATE_NOTIFICATION_ID,
    title: `HandCash ${version} available`,
    body: 'Tap to download the latest beta APK',
    channelId: UPDATE_CHANNEL,
    extra: { kind: 'update', releaseUrl: detail.releaseUrl ?? null },
  })
}

async function notifyPermissionRequest(detail: {
  title?: string
  origin?: string
  kind?: string
  appName?: string
}): Promise<void> {
  if (!(await ensureNotifications())) return
  // Always heads-up for any pending wallet request. Foreground still shows
  // the in-app prompt; OEMs often leave Chrome on top while HandCash is
  // "active", so skipping when appActive left users with no notification.
  await dismissPermissionNotification()
  const origin = detail.origin?.trim()
  const appName =
    detail.appName?.trim() || (origin ? appDisplayName(origin) : '') || 'App'
  const isConnect = detail.kind === 'connect'
  const title =
    detail.title?.trim() || (isConnect ? `Connect to ${appName}` : `${appName} request`)
  const body = isConnect
    ? 'Open HandCash to approve'
    : origin
      ? `${appName} needs your approval in HandCash`
      : 'Open HandCash to approve'
  await scheduleLocal({
    id: PERMISSION_NOTIFICATION_ID,
    title,
    body,
    channelId: PERMISSION_CHANNEL,
    extra: { kind: 'permission', origin: origin ?? null },
  })
}

async function notifyWalletConnected(detail: {
  appName?: string
  origin?: string
}): Promise<void> {
  await dismissPermissionNotification()
  if (appActive || !(await ensureNotifications())) return
  const appName =
    detail.appName?.trim() ||
    (detail.origin?.trim() ? appDisplayName(detail.origin) : '') ||
    'app'
  await scheduleLocal({
    id: allocateNotificationId(),
    title: `Wallet connected to ${appName}`,
    body: 'You can return to the app',
    channelId: RECEIVE_CHANNEL,
    extra: { kind: 'connected', origin: detail.origin ?? null },
  })
}

/** Install Android lifecycle, background sync, and notification plumbing once. */
export function installBackgroundRuntime(): void {
  if (!Capacitor.isNativePlatform()) return

  // Do not assume the first JS frame is foreground. Android may recreate the
  // WebView behind another activity without emitting a transition first.
  void CapacitorApp.getState()
    .then(({ isActive }) => {
      appActive = isActive
    })
    .catch(() => {
      // appStateChange remains the source after startup.
    })

  void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    appActive = isActive
    if (isActive) {
      document.dispatchEvent(new Event('handcash:app-active'))
    }
  })

  document.addEventListener('handcash:wallet-unlocked', () => {
    void ensureNotifications()
    void startForegroundSync()
  })
  document.addEventListener('handcash:wallet-locked', () => {
    void stopForegroundSync()
  })
  document.addEventListener('handcash:receive', (event) => {
    const detail = (event as CustomEvent<{ title?: string; body?: string }>).detail ?? {}
    runNotification('receive', () => notifyReceive(detail))
  })
  document.addEventListener('handcash:spend', (event) => {
    const detail =
      (
        event as CustomEvent<{
          title?: string
          body?: string
          txid?: string
          method?: string
        }>
      ).detail ?? {}
    runNotification('spend', () => notifySpend(detail))
  })
  document.addEventListener('handcash:permission-request', (event) => {
    const detail =
      (event as CustomEvent<{
        title?: string
        origin?: string
        kind?: string
        appName?: string
      }>).detail ?? {}
    // focusWindow already runs from Desktop permissions; re-fire + retry for OEM races.
    void nativeBringToFront()
    window.setTimeout(() => void nativeBringToFront(), 280)
    window.setTimeout(() => void nativeBringToFront(), 900)
    runNotification('permission', () => notifyPermissionRequest(detail))
  })
  document.addEventListener('handcash:wallet-connected', (event) => {
    const detail =
      (event as CustomEvent<{ appName?: string; origin?: string }>).detail ?? {}
    runNotification('connected', () => notifyWalletConnected(detail))
  })
  document.addEventListener('handcash:permission-dismissed', () => {
    void dismissPermissionNotification()
  })
  document.addEventListener('handcash:update-available', (event) => {
    const detail =
      (event as CustomEvent<{ version?: string; releaseUrl?: string | null }>).detail ?? {}
    if (appActive) return
    runNotification('update', () => notifyUpdateAvailable(detail))
  })

  void LocalNotifications.addListener('localNotificationReceived', (notification) => {
    appendAppLog(
      'info',
      `[mobile-notifications] delivered channel=${
        notification.channelId ?? 'unknown'
      } id=${notification.id}`,
    )
  })
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    appendAppLog(
      'info',
      `[mobile-notifications] opened id=${action.notification.id}`,
    )
    document.dispatchEvent(new Event('handcash:app-active'))
    const releaseUrl = action.notification.extra?.releaseUrl
    if (typeof releaseUrl === 'string' && releaseUrl.startsWith('http')) {
      void window.handcash?.openExternal?.(releaseUrl)
    }
  })
}
