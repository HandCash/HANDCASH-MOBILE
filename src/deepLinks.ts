import { App as CapacitorApp } from '@capacitor/app'
import { appendAppLog } from '@desktop/wallet/appLog'
import { routeWalletDeepLink } from '@desktop/wallet/deepLink'

/**
 * OS links (`peerpay:` today) reach the wallet two ways: the app was already
 * running, or the link launched it. The second case has no `appUrlOpen` event
 * yet when this installs, so the launch URL is read once as well.
 *
 * The shell only carries the URL across; what a link is allowed to do is the UI
 * core's decision (`routeWalletDeepLink`).
 */
export function installDeepLinks(): void {
  const route = (url: string, source: 'launch' | 'resume') => {
    const decision = routeWalletDeepLink(url)
    if (decision.kind === 'refuse') {
      appendAppLog('warn', `[deep-link] ${source} refused (${decision.reason})`)
      return
    }
    appendAppLog('info', `[deep-link] ${source} opened Send`)
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
