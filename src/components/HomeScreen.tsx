import { useState } from 'react'
import {
  getHistoryBackupUrl,
  readVaultMeta,
  unlockVault,
  wipeVault,
} from '../wallet/vault'

type Props = {
  onWipe: () => void
}

export function HomeScreen({ onWipe }: Props) {
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
          <p className="hint">Unlock the wallet linked from Desktop.</p>
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
          <p className="hint">
            Same wallet as Desktop. History sync keeps balances aligned when a BRC-39 URL is set.
          </p>
          <p className="meta-line mono">{meta?.identityKey}</p>
          <p className="meta-line mono">{meta?.address}</p>
          {historyUrl ? (
            <p className="meta-line mono">Sync: {historyUrl}</p>
          ) : (
            <p className="hint">No history sync URL stored — set History backup on Desktop.</p>
          )}
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
