import { useState } from 'react'
import { HomeScreen } from './components/HomeScreen'
import { OnboardingScreen } from './components/OnboardingScreen'
import { ScanLinkScreen } from './components/ScanLinkScreen'
import { ShowLinkScreen } from './components/ShowLinkScreen'
import { hasVault } from './wallet/vault'

type Screen = 'onboarding' | 'connect' | 'show-link' | 'home'

export function App() {
  const [screen, setScreen] = useState<Screen>(() => (hasVault() ? 'home' : 'onboarding'))

  return (
    <div className="app" data-aeon-scope="mobile">
      <header className="brand">
        <div className="brand-mark" aria-hidden>
          HC
        </div>
        <div className="brand-wordmark">
          <strong>HandCash</strong>
          <span>Mobile · BETA</span>
        </div>
      </header>

      {screen === 'onboarding' ? (
        <OnboardingScreen
          onDone={() => setScreen('home')}
          onConnect={() => setScreen('connect')}
        />
      ) : null}

      {screen === 'connect' ? (
        <ScanLinkScreen
          onBack={() => setScreen(hasVault() ? 'home' : 'onboarding')}
          onLinked={() => setScreen('home')}
        />
      ) : null}

      {screen === 'show-link' ? (
        <ShowLinkScreen onBack={() => setScreen('home')} />
      ) : null}

      {screen === 'home' ? (
        <HomeScreen
          onWipe={() => setScreen('onboarding')}
          onShowLink={() => setScreen('show-link')}
          onScanLink={() => setScreen('connect')}
        />
      ) : null}
    </div>
  )
}
