import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { createEmbeddedPairingOffer, type PairingOfferV2 } from '../pairing/protocol'
import { getHistoryBackupUrl, unlockVault } from '../wallet/vault'

type Props = {
  onBack: () => void
}

const TTL_MS = 120_000

export function ShowLinkScreen({ onBack }: Props) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [offer, setOffer] = useState<PairingOfferV2 | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (!offer) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((offer.expiresAt - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left <= 0) {
        setOffer(null)
        setQrDataUrl(null)
      }
    }
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [offer])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const { rootKeyHex, record } = await unlockVault(password)
      const { offer: next, qrText } = await createEmbeddedPairingOffer(
        {
          v: 1,
          rootKeyHex,
          handle: record.handle,
          identityKey: record.identityKey,
          address: record.address,
          chain: record.chain,
          historyBackupBaseUrl: getHistoryBackupUrl(),
          createdAt: Date.now(),
        },
        TTL_MS,
      )
      const dataUrl = await QRCode.toDataURL(qrText, {
        margin: 1,
        width: 280,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      setOffer(next)
      setQrDataUrl(dataUrl)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hero">
      <div className="screen-title">
        <h2>Show link QR</h2>
        <button type="button" className="back" onClick={onBack}>
          Back
        </button>
      </div>
      <p className="hint">
        Let Desktop (or another phone) scan this QR under Connect existing / Link device → Scan.
      </p>

      {!qrDataUrl ? (
        <>
          <div className="field">
            <label htmlFor="show-pw">Wallet password</label>
            <input
              id="show-pw"
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
            onClick={() => void start()}
          >
            {busy ? 'Working…' : 'Show link QR'}
          </button>
        </>
      ) : (
        <div className="link-qr">
          <img src={qrDataUrl} alt="Link QR" width={280} height={280} />
          <p className="hint">Expires in {secondsLeft}s</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setQrDataUrl(null)
              setOffer(null)
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
