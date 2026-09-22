import { registerPlugin } from '@capacitor/core'
import { wrapOk } from './nativeResult'

type DappBrowserPlugin = {
  open(options: { url: string }): Promise<void>
}

const Native = registerPlugin<DappBrowserPlugin>('DappBrowser')

/**
 * Opens http(s) in the wallet's own in-app browser (`DappBrowserActivity`),
 * which proxies the page's CWI calls to the local BRC-100 bridge on :3321.
 * {@code peerpay:} links are still handed to the OS, not loaded in place.
 */
export async function nativeOpenDappBrowser(
  url: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return wrapOk(() => Native.open({ url }))
}
