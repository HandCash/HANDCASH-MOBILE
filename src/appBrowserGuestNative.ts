import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { APP_BROWSER_BRIDGE_SHIM } from './appBrowserBridgeShim'

type AppBrowserGuestPlugin = Omit<AppBrowserGuestBridge, 'onEvent' | 'create'> & {
  create(options: Parameters<AppBrowserGuestBridge['create']>[0] & { bridgeShim: string }): Promise<void>

  setPromptOpen(options: { open: boolean }): Promise<void>
  addListener(
    event: 'guestEvent',
    handler: (event: AppBrowserGuestEvent) => void,
  ): Promise<PluginListenerHandle>
}

const Native = registerPlugin<AppBrowserGuestPlugin>('AppBrowserGuest')

/**
 * The core's browser panel draws app tabs through this: a native WebView the
 * shell lays over the panel (`AppBrowserGuestPlugin`), standing in for
 * Desktop's `<webview>`.
 */
export function nativeAppBrowserGuest(): AppBrowserGuestBridge {
  return {
    create: (options) => Native.create({ ...options, bridgeShim: APP_BROWSER_BRIDGE_SHIM }),
    setBounds: (options) => Native.setBounds(options),
    navigate: (options) => Native.navigate(options),
    capture: (options) => Native.capture(options),
    destroy: (options) => Native.destroy(options),
    onEvent: (handler) => {
      const pending = Native.addListener('guestEvent', handler)
      return () => {
        void pending.then((handle) => handle.remove())
      }
    },
  }
}

/** No page may sit over a permission prompt, whatever the panel reports. */
export function noteAppBrowserPromptOpen(open: boolean): void {
  void Native.setPromptOpen({ open }).catch(() => undefined)
}
