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
  enroll(options: { password: string }): Promise<{ ok?: boolean }>
  unlock(options?: { reason?: string }): Promise<{ ok?: boolean; password: string }>
  clear(): Promise<void>
}

const Native = registerPlugin<DeviceAuthPlugin>('DeviceAuth')

export async function nativeDeviceAuthStatus(): Promise<DeviceAuthStatus> {
  try {
    return await Native.status()
  } catch {
    return { available: false, enrolled: false, label: 'Biometrics' }
  }
}

export async function nativeDeviceAuthEnroll(
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await Native.enroll({ password })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function nativeDeviceAuthUnlock(
  reason = 'Unlock HandCash',
): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  try {
    const res = await Native.unlock({ reason })
    if (!res.password) return { ok: false, error: 'No password returned' }
    return { ok: true, password: res.password }
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
