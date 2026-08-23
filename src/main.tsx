import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'aeon-ui-engine/aeon.css'
import '@aeon-ui/panda/electron.css'
import '@handcash/wallet-ui/styles/handcash.css'
import '@handcash/wallet-ui/wallet/browserPolyfills'
import './mobile-overrides.css'
import { installMobileBridge } from './bridge'
import { installBackgroundRuntime } from './backgroundRuntime'
import { App } from '@handcash/wallet-ui/App'
import { startHandCashTheme } from '@handcash/wallet-ui/wallet/handcashTheme'
import { installKeyboardInset } from '@handcash/wallet-ui/wallet/keyboardInset'
import { installCapacitorKeyboard } from './capacitorKeyboard'
import { installDeepLinks } from './deepLinks'
import { startMobileChromeTheme } from './mobileChromeTheme'

installMobileBridge()
installBackgroundRuntime()

// Same appearance stack as Desktop — system / light / dark from Settings.
startHandCashTheme()
startMobileChromeTheme()

document.documentElement.classList.add('platform-mobile')
document.documentElement.dataset.aeonPlatform = window.handcash?.platform || 'android'
installKeyboardInset()
void installCapacitorKeyboard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// After render: a link routes through the nav store, which the mounted App is
// already subscribed to (a locked wallet still gates the screen).
installDeepLinks()
