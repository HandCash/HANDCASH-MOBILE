/**
 * Device-link pairing (Telegram-style).
 * Desktop hosts a short-lived LAN HTTPS/HTTP package; mobile scans QR and pulls vault.
 */

export const PAIRING_QR_PREFIX = 'handcash-link:'

export type PairingOffer = {
  v: 1
  /** Base URL of the pairing host, e.g. http://192.168.1.12:17921 */
  baseUrl: string
  sessionId: string
  /** AES-GCM key, hex — one-time unwrap of the package */
  keyHex: string
  expiresAt: number
  handle?: string
}

export type PairingPackage = {
  v: 1
  rootKeyHex: string
  handle: string
  identityKey: string
  address: string
  chain: 'main' | 'test'
  historyBackupBaseUrl: string
  createdAt: number
}

export function encodePairingQr(offer: PairingOffer): string {
  const json = JSON.stringify(offer)
  const b64 =
    typeof btoa === 'function'
      ? btoa(json)
      : Buffer.from(json, 'utf8').toString('base64')
  return `${PAIRING_QR_PREFIX}${b64}`
}

export function decodePairingQr(raw: string): PairingOffer {
  const text = raw.trim()
  if (!text.startsWith(PAIRING_QR_PREFIX)) {
    throw new Error('Not a HandCash link QR')
  }
  const b64 = text.slice(PAIRING_QR_PREFIX.length)
  const json =
    typeof atob === 'function'
      ? atob(b64)
      : Buffer.from(b64, 'base64').toString('utf8')
  const offer = JSON.parse(json) as PairingOffer
  if (offer.v !== 1 || !offer.baseUrl || !offer.sessionId || !offer.keyHex) {
    throw new Error('Invalid link payload')
  }
  if (offer.expiresAt < Date.now()) {
    throw new Error('Link QR expired — generate a new one on Desktop')
  }
  return offer
}

function toBuf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export async function encryptPairingPackage(
  pkg: PairingPackage,
  keyHex: string,
): Promise<{ ivHex: string; ciphertextHex: string }> {
  const keyBytes = hexToBytes(keyHex)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', toBuf(keyBytes), 'AES-GCM', false, [
    'encrypt',
  ])
  const plain = new TextEncoder().encode(JSON.stringify(pkg))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  return {
    ivHex: bytesToHex(new Uint8Array(iv)),
    ciphertextHex: bytesToHex(new Uint8Array(cipher)),
  }
}

export async function decryptPairingPackage(
  ivHex: string,
  ciphertextHex: string,
  keyHex: string,
): Promise<PairingPackage> {
  const keyBytes = hexToBytes(keyHex)
  const iv = hexToBytes(ivHex)
  const cipher = hexToBytes(ciphertextHex)
  const key = await crypto.subtle.importKey('raw', toBuf(keyBytes), 'AES-GCM', false, [
    'decrypt',
  ])
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuf(iv) },
    key,
    toBuf(cipher),
  )
  const pkg = JSON.parse(new TextDecoder().decode(plain)) as PairingPackage
  if (pkg.v !== 1 || !pkg.rootKeyHex) throw new Error('Invalid pairing package')
  return pkg
}

export function randomKeyHex(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes))
  return bytesToHex(arr)
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '')
  if (clean.length % 2 !== 0) throw new Error('Invalid hex')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** Fetch encrypted package from Desktop pairing host. */
export async function fetchPairingCiphertext(
  offer: PairingOffer,
): Promise<{ ivHex: string; ciphertextHex: string }> {
  const url = `${offer.baseUrl.replace(/\/+$/, '')}/pair/${offer.sessionId}`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Pairing host error (${res.status})`)
  }
  const body = (await res.json()) as { ivHex?: string; ciphertextHex?: string }
  if (!body.ivHex || !body.ciphertextHex) throw new Error('Malformed pairing response')
  return { ivHex: body.ivHex, ciphertextHex: body.ciphertextHex }
}
