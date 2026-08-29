import { registerPlugin } from '@capacitor/core'

type DappBrowserPlugin = {
  open(options: { url: string }): Promise<void>
}

const Native = registerPlugin<DappBrowserPlugin>('DappBrowser')

/**
 * Opens http(s) in the system browser. There is no in-app WebView. The page
 * comes back through a {@code peerpay:} link the OS delivers to the wallet.
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
