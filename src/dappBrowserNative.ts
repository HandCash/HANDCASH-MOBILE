import { registerPlugin } from '@capacitor/core'
import { wrapOk } from './nativeResult'

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
  return wrapOk(() => Native.open({ url }))
}
