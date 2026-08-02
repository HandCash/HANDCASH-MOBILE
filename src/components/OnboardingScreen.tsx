import { useState } from 'react'
import { PrivateKey } from '@bsv/sdk'
import {
  createVault,
  restoreFromMnemonic,
  restoreFromRootKey,
} from '../wallet/vault'

type Props = {
  onDone: () => void
  onConnect: () => void
}

type Mode = 'menu' | 'create' | 'phrase' | 'key'

export function OnboardingScreen({ onDone, onConnect }: Props) {
  const [mode, setMode] = useState<Mode>('menu')
  const [password, setPassword] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [rootKey, setRootKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'create') await createVault(password)
      else if (mode === 'phrase') {
        await restoreFromMnemonic({ mnemonic, password })
      } else if (mode === 'key') {
        const hex = rootKey.trim().replace(/^0x/i, '')
        PrivateKey.fromHex(hex)
        await restoreFromRootKey({ rootKeyHex: hex, password })
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'menu') {
    return (
      <div className="hero">
        <h1>Your wallet, on this phone</h1>
        <p>Same HandCash Desktop experience — create, restore, or connect another device.</p>
        <div className="card-stack">
          <button type="button" className="action-card" onClick={() => setMode('create')}>
            <strong>Create wallet</strong>
            <span>New keys on this phone</span>
          </button>
          <button type="button" className="action-card" onClick={onConnect}>
            <strong>Connect existing wallet</strong>
            <span>Scan a link QR from Desktop or another phone</span>
          </button>
          <button type="button" className="action-card" onClick={() => setMode('phrase')}>
            <strong>Restore phrase</strong>
            <span>12-word recovery phrase</span>
          </button>
          <button type="button" className="action-card" onClick={() => setMode('key')}>
            <strong>Restore key</strong>
            <span>Emergency 64-hex root key</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="hero">
      <div className="screen-title">
        <h2>
          {mode === 'create' ? 'Create wallet' : mode === 'phrase' ? 'Restore phrase' : 'Restore key'}
        </h2>
        <button type="button" className="back" onClick={() => setMode('menu')}>
          Back
        </button>
      </div>

      {mode === 'phrase' ? (
        <div className="field">
          <label htmlFor="mnemonic">Recovery phrase</label>
          <input
            id="mnemonic"
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            placeholder="twelve words…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
      ) : null}

      {mode === 'key' ? (
        <div className="field">
          <label htmlFor="root-key">Emergency root key</label>
          <input
            id="root-key"
            value={rootKey}
            onChange={(e) => setRootKey(e.target.value)}
            placeholder="64 hex characters"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="pw">Password for this phone</label>
        <input
          id="pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="10+ chars, letter and number"
          autoComplete="new-password"
        />
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}>
        {busy ? 'Working…' : mode === 'create' ? 'Create' : 'Restore'}
      </button>
    </div>
  )
}
