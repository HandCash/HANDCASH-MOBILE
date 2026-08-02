import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import {
  decodePairingQr,
  decryptPairingPackage,
  fetchPairingCiphertext,
  type PairingPackage,
} from '../pairing/protocol'
import { installLinkedVault, setHistoryBackupUrl } from '../wallet/vault'

type Props = {
  onLinked: () => void
  onBack: () => void
}

export function ScanLinkScreen({ onLinked, onBack }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [pkg, setPkg] = useState<PairingPackage | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState('')
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const handledRef = useRef(false)

  useEffect(() => {
    if (pkg) return
    const id = 'hc-qr-reader'
    const scanner = new Html5Qrcode(id)
    scannerRef.current = scanner
    let cancelled = false

    const onScan = async (text: string) => {
      if (handledRef.current || cancelled) return
      handledRef.current = true
      try {
        setBusy(true)
        setError(null)
        const offer = decodePairingQr(text)
        const cipher = await fetchPairingCiphertext(offer)
        const next = await decryptPairingPackage(cipher.ivHex, cipher.ciphertextHex, offer.keyHex)
        await scanner.stop().catch(() => undefined)
        setPkg(next)
      } catch (err) {
        handledRef.current = false
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    }

    void scanner
      .start(
        { facingMode: 'environment' },
        { fps: 8, qrbox: { width: 240, height: 240 } },
        (text) => void onScan(text),
        () => undefined,
      )
      .catch((err: unknown) => {
        setError(
          err instanceof Error
            ? `${err.message}. You can paste the link payload below.`
            : 'Camera unavailable — paste the link payload below.',
        )
      })

    return () => {
      cancelled = true
      void scanner.stop().catch(() => undefined)
      scannerRef.current = null
    }
  }, [pkg])

  const submitManual = async () => {
    handledRef.current = false
    setError(null)
    setBusy(true)
    try {
      const offer = decodePairingQr(manual)
      const cipher = await fetchPairingCiphertext(offer)
      const next = await decryptPairingPackage(cipher.ivHex, cipher.ciphertextHex, offer.keyHex)
      void scannerRef.current?.stop().catch(() => undefined)
      setPkg(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    if (!pkg) return
    setBusy(true)
    setError(null)
    try {
      await installLinkedVault({
        rootKeyHex: pkg.rootKeyHex,
        password,
        handle: pkg.handle,
        identityKey: pkg.identityKey,
        address: pkg.address,
        chain: pkg.chain,
      })
      if (pkg.historyBackupBaseUrl) setHistoryBackupUrl(pkg.historyBackupBaseUrl)
      onLinked()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hero">
      <div className="screen-title">
        <h2>{pkg ? 'Set phone password' : 'Scan to link'}</h2>
        <button type="button" className="back" onClick={onBack}>
          Back
        </button>
      </div>

      {!pkg ? (
        <>
          <p className="hint">
            On Desktop: Settings → Link device → Show link QR. Phone and computer must be on the
            same Wi‑Fi.
          </p>
          <div id="hc-qr-reader" className="scanner-shell" />
          <div className="field">
            <label htmlFor="manual-link">Or paste link payload</label>
            <input
              id="manual-link"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="handcash-link:…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || !manual.trim()}
            onClick={() => void submitManual()}
          >
            Use pasted link
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            Linked wallet <strong>{pkg.handle || pkg.identityKey.slice(0, 12)}</strong>. Choose a
            password for this phone (can differ from Desktop).
          </p>
          {pkg.historyBackupBaseUrl ? (
            <p className="meta-line mono">History sync: {pkg.historyBackupBaseUrl}</p>
          ) : (
            <p className="hint">No history sync URL on Desktop — set one there for multi-device balance.</p>
          )}
          <div className="field">
            <label htmlFor="link-password">Phone password</label>
            <input
              id="link-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="10+ chars, letter and number"
              autoComplete="new-password"
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || password.length < 10}
            onClick={() => void finish()}
          >
            {busy ? 'Saving…' : 'Finish link'}
          </button>
        </>
      )}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
