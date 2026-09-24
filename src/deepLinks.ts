import { App as CapacitorApp } from '@capacitor/app'
import { appendAppLog } from '@desktop/wallet/appLog'
import { decideWalletDeepLink } from '@desktop/wallet/deepLink'
import { openSendFlow } from '@desktop/wallet/navStore'
import { nativeBringToFront } from './deviceAuthNative'

/**
 * OS links reach the wallet two ways: the app was already running, or the link
 * launched it. The second case has no `appUrlOpen` event yet when this installs,
 * so the launch URL is read once as well.
 *
 * The claimed schemes are the vendor-neutral BRCs this wallet already parses
 * from Scan and paste — `peerpay:` (BRC-125 pay request) and `brc29:` (BRC-29
 * settlement receipt). Each must also be declared in `scripts/patch-android.mjs`,
 * which rebuilds the manifest after every `cap sync`.
 *
 * The shell only carries the URL across; what a link is allowed to do is the UI
 * core's decision (`decideWalletDeepLink`).
 */
export function installDeepLinks(): void {
  const route = (url: string, source: 'launch' | 'resume') => {
    const decision = decideWalletDeepLink(url)
    if (decision.kind === 'refuse') {
      appendAppLog('warn', `[deep-link] ${source} refused (${decision.reason})`)
      return
    }
    appendAppLog('info', `[deep-link] ${source} opened Send (${decision.kind})`)
    openSendFlow(decision.uri)
    void nativeBringToFront()
  }

  void CapacitorApp.addListener('appUrlOpen', (event) => {
    if (event.url) route(event.url, 'resume')
  })

  void CapacitorApp.getLaunchUrl()
    .then((launch) => {
      if (launch?.url) route(launch.url, 'launch')
    })
    .catch(() => {
      // No launch URL on a normal cold start.
    })
}
