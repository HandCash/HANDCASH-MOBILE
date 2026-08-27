import { registerPlugin } from '@capacitor/core'

type DeviceAuthStatus = {
  available: boolean
  enrolled: boolean
  label: string
  /** True when the unlock key is StrongBox-backed (Android hardware SE). */
  strongBox?: boolean
}

type DeviceAuthPlugin = {
  status(): Promise<DeviceAuthStatus>
  enroll(options: { secret: string; password?: string }): Promise<{ ok?: boolean }>
  unlock(options?: { reason?: string }): Promise<{ ok?: boolean; secret?: string; password?: string }>
  clear(): Promise<void>
  bringToFront(): Promise<void>
}

const Native = registerPlugin<DeviceAuthPlugin>('DeviceAuth')

export async function nativeDeviceAuthStatus(): Promise<DeviceAuthStatus> {
  try {
    return await Native.status()
  } catch {
    return { available: false, enrolled: false, label: 'Device unlock' }
  }
}

export async function nativeDeviceAuthEnroll(
  secret: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await Native.enroll({ secret })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function nativeDeviceAuthUnlock(
  reason = 'Unlock HandCash',
): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  try {
    const res = await Native.unlock({ reason })
    const secret = res.secret || res.password
    if (!secret) return { ok: false, error: 'No unlock material returned' }
    return { ok: true, secret }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

export async function nativeDeviceAuthClear(): Promise<void> {
  try {
    await Native.clear()
  } catch {
    // ignore
  }
}

/** Bring MainActivity to the foreground for an incoming permission request. */
export async function nativeBringToFront(): Promise<void> {
  try {
    await Native.bringToFront()
  } catch {
    // OEM may block background startActivity — notification path still covers it.
  }
}
