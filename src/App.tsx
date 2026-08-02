import { useState } from 'react'
import { HomeScreen } from './components/HomeScreen'
import { ScanLinkScreen } from './components/ScanLinkScreen'
import { hasVault } from './wallet/vault'

type Screen = 'welcome' | 'scan' | 'home'

export function App() {
  const [screen, setScreen] = useState<Screen>(() => (hasVault() ? 'home' : 'welcome'))

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

      {screen === 'welcome' ? (
        <div className="hero">
          <h1>Your wallet, on this phone</h1>
          <p>
            Same look as Desktop — start by scanning a link QR from an unlocked HandCash Desktop on
            your Wi‑Fi.
          </p>
          <div className="card-stack">
            <button type="button" className="action-card" onClick={() => setScreen('scan')}>
              <strong>Scan to link</strong>
              <span>Telegram-style login from Desktop</span>
            </button>
          </div>
          <p className="hint">
            History sync (BRC-39 URL) is recommended on Desktop so both devices stay aligned.
          </p>
        </div>
      ) : null}

      {screen === 'scan' ? (
        <ScanLinkScreen
          onBack={() => setScreen(hasVault() ? 'home' : 'welcome')}
          onLinked={() => setScreen('home')}
        />
      ) : null}

      {screen === 'home' ? <HomeScreen onWipe={() => setScreen('welcome')} /> : null}
    </div>
  )
}
