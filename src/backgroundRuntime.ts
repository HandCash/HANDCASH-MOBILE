import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import {
  ForegroundService,
  Importance,
} from '@capawesome-team/capacitor-android-foreground-service'
import { LocalNotifications } from '@capacitor/local-notifications'
import { appendAppLog } from '@desktop/wallet/appLog'
import { nativeBringToFront } from './deviceAuthNative'

const SYNC_CHANNEL = 'handcash-sync'
const RECEIVE_CHANNEL = 'handcash-receive'
const PERMISSION_CHANNEL = 'handcash-permission'
const FOREGROUND_NOTIFICATION_ID = 15301
const PERMISSION_NOTIFICATION_ID = 15302

let appActive = true
let foregroundRunning = false
let notificationsReady = false

async function ensureNotifications(): Promise<boolean> {
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

async function notifyReceive(detail: { title?: string; body?: string }): Promise<void> {
  if (appActive || !(await ensureNotifications())) return
  await LocalNotifications.schedule({
    notifications: [
      {
        id: Math.floor(Date.now() % 2_000_000_000),
        title: detail.title?.trim() || 'Wallet updated',
        body: detail.body?.trim() || 'New wallet activity is available',
        channelId: RECEIVE_CHANNEL,
        smallIcon: 'ic_stat_handcash',
        schedule: { at: new Date(Date.now() + 100), allowWhileIdle: true },
      },
    ],
  })
}

async function notifyPermissionRequest(detail: {
  title?: string
  origin?: string
}): Promise<void> {
  if (!(await ensureNotifications())) return
  // Always schedule when backgrounded so the user can tap in if bringToFront is blocked.
  if (appActive) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: PERMISSION_NOTIFICATION_ID }] })
  } catch {
    // ignore
  }
  const origin = detail.origin?.trim()
  await LocalNotifications.schedule({
    notifications: [
      {
        id: PERMISSION_NOTIFICATION_ID,
        title: detail.title?.trim() || 'Wallet request',
        body: origin
          ? `${origin} needs your approval in HandCash`
          : 'An app needs your approval in HandCash',
        channelId: PERMISSION_CHANNEL,
        smallIcon: 'ic_stat_handcash',
        schedule: { at: new Date(Date.now() + 50), allowWhileIdle: true },
      },
    ],
  })
}

/** Install Android lifecycle, background sync, and notification plumbing once. */
export function installBackgroundRuntime(): void {
  if (!Capacitor.isNativePlatform()) return

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
    void notifyReceive(detail)
  })
  document.addEventListener('handcash:permission-request', (event) => {
    const detail =
      (event as CustomEvent<{ title?: string; origin?: string }>).detail ?? {}
    // focusWindow already runs from Desktop permissions; re-fire for OEM races.
    void nativeBringToFront()
    void notifyPermissionRequest(detail)
  })

  void LocalNotifications.addListener('localNotificationActionPerformed', () => {
    document.dispatchEvent(new Event('handcash:app-active'))
  })
}
