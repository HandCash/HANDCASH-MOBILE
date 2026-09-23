import { registerPlugin } from '@capacitor/core'
import { wrapOk } from './nativeResult'

type SystemBrowserPlugin = {
  open(options: { url: string }): Promise<void>
}

const Native = registerPlugin<SystemBrowserPlugin>('SystemBrowser')

/**
 * Hands the link to the OS default browser / mail client, the way Desktop's
 * `shell.openExternal` does. Never loads it in a wallet-owned WebView.
 */
export async function nativeOpenSystemBrowser(
  url: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return wrapOk(() => Native.open({ url }))
}
