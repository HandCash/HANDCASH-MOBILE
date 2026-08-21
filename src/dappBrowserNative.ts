import { registerPlugin } from '@capacitor/core'

type DappBrowserPlugin = {
  open(options: { url: string }): Promise<void>
}

const Native = registerPlugin<DappBrowserPlugin>('DappBrowser')

/**
 * Opens a BRC-100 web app in the in-app WebView (DappBrowserActivity). The
 * wallet WebView keeps running behind it, which is what lets the page reach the
 * bridge on loopback:3321 and lets a permission prompt pull the wallet forward.
 */
export async function nativeOpenDappBrowser(
  url: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await Native.open({ url })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
