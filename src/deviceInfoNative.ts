import { registerPlugin } from '@capacitor/core'

export type MobileDeviceInfo = {
  grapheneOs: boolean
  playServicesInstalled: boolean
  androidSdk: number
  manufacturer: string
  model: string
  sideloadUpdates: boolean
}

type DeviceInfoPlugin = {
  get(): Promise<MobileDeviceInfo>
}

const Native = registerPlugin<DeviceInfoPlugin>('DeviceInfo')

const FALLBACK: MobileDeviceInfo = {
  grapheneOs: false,
  playServicesInstalled: false,
  androidSdk: 0,
  manufacturer: '',
  model: '',
  sideloadUpdates: true,
}

export async function nativeDeviceInfo(): Promise<MobileDeviceInfo> {
  try {
    return await Native.get()
  } catch {
    return FALLBACK
  }
}
