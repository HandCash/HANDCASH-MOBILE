import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

type AppBrowserGuestPlugin = Omit<AppBrowserGuestBridge, 'onEvent'> & {
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
    create: (options) => Native.create(options),
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
