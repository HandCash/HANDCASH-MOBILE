import { useState } from 'react'
import {
  getHistoryBackupUrl,
  readVaultMeta,
  unlockVault,
  wipeVault,
} from '../wallet/vault'

type Props = {
  onWipe: () => void
  onShowLink: () => void
  onScanLink: () => void
}

export function HomeScreen({ onWipe, onShowLink, onScanLink }: Props) {
  const meta = readVaultMeta()
  const historyUrl = getHistoryBackupUrl()
  const [password, setPassword] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const unlock = async () => {
    setBusy(true)
    setError(null)
    try {
      await unlockVault(password)
      setUnlocked(true)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hero">
      <h1>{meta?.handle || 'Wallet'}</h1>
      {!unlocked ? (
        <>
          <p className="hint">Unlock this phone’s wallet.</p>
          <div className="field">
            <label htmlFor="unlock-password">Password</label>
            <input
              id="unlock-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || password.length < 8}
            onClick={() => void unlock()}
          >
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </>
      ) : (
        <>
          <div className="home-balance">Ready</div>
          <p className="meta-line mono">{meta?.identityKey}</p>
          <p className="meta-line mono">{meta?.address}</p>
          {historyUrl ? (
            <p className="meta-line mono">Sync: {historyUrl}</p>
          ) : (
            <p className="hint">Set History backup on Desktop for multi-device balance sync.</p>
          )}
          <div className="card-stack">
            <button type="button" className="action-card" onClick={onShowLink}>
              <strong>Show link QR</strong>
              <span>Let another device connect to this wallet</span>
            </button>
            <button type="button" className="action-card" onClick={onScanLink}>
              <strong>Scan to connect</strong>
              <span>Pull a wallet shown on another device</span>
            </button>
          </div>
        </>
      )}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          if (confirm('Remove wallet from this phone?')) {
            wipeVault()
            onWipe()
          }
        }}
      >
        Remove from this phone
      </button>
    </div>
  )
}
