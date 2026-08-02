/**
 * Device-link pairing — keep in sync with HANDCASH-DESKTOP deviceLinkProtocol.ts
 */

export const PAIRING_QR_PREFIX = 'handcash-link:'

export type PairingOfferV2 = {
  v: 2
  keyHex: string
  ivHex: string
  ciphertextHex: string
  expiresAt: number
  handle?: string
}

export type PairingOfferV1 = {
  v: 1
  baseUrl: string
  sessionId: string
  keyHex: string
  expiresAt: number
  handle?: string
}

export type PairingOffer = PairingOfferV2 | PairingOfferV1

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

function toBuf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function randomKeyHex(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes))
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function b64Encode(json: string): string {
  return typeof btoa === 'function' ? btoa(json) : Buffer.from(json, 'utf8').toString('base64')
}

function b64Decode(b64: string): string {
  return typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8')
}

export async function encryptPairingPackage(
  pkg: PairingPackage,
  keyHex: string,
): Promise<{ ivHex: string; ciphertextHex: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', toBuf(hexToBytes(keyHex)), 'AES-GCM', false, [
    'encrypt',
  ])
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(pkg)),
  )
  return {
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(new Uint8Array(cipher)),
  }
}

export async function decryptPairingPackage(
  ivHex: string,
  ciphertextHex: string,
  keyHex: string,
): Promise<PairingPackage> {
  const key = await crypto.subtle.importKey('raw', toBuf(hexToBytes(keyHex)), 'AES-GCM', false, [
    'decrypt',
  ])
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuf(hexToBytes(ivHex)) },
    key,
    toBuf(hexToBytes(ciphertextHex)),
  )
  const pkg = JSON.parse(new TextDecoder().decode(plain)) as PairingPackage
  if (pkg.v !== 1 || !pkg.rootKeyHex) throw new Error('Invalid pairing package')
  return pkg
}

export function encodePairingQr(offer: PairingOffer): string {
  return `${PAIRING_QR_PREFIX}${b64Encode(JSON.stringify(offer))}`
}

export function decodePairingQr(raw: string): PairingOffer {
  const text = raw.trim()
  if (!text.startsWith(PAIRING_QR_PREFIX)) throw new Error('Not a HandCash link QR')
  const offer = JSON.parse(b64Decode(text.slice(PAIRING_QR_PREFIX.length))) as PairingOffer
  if (offer.expiresAt < Date.now()) throw new Error('Link QR expired — generate a new one')
  if (offer.v === 2) {
    if (!offer.keyHex || !offer.ivHex || !offer.ciphertextHex) throw new Error('Invalid link payload')
    return offer
  }
  if (offer.v === 1) {
    if (!offer.baseUrl || !offer.sessionId || !offer.keyHex) throw new Error('Invalid link payload')
    return offer
  }
  throw new Error('Unsupported link version')
}

export async function createEmbeddedPairingOffer(
  pkg: PairingPackage,
  ttlMs = 120_000,
): Promise<{ offer: PairingOfferV2; qrText: string }> {
  const keyHex = randomKeyHex(32)
  const enc = await encryptPairingPackage(pkg, keyHex)
  const offer: PairingOfferV2 = {
    v: 2,
    keyHex,
    ivHex: enc.ivHex,
    ciphertextHex: enc.ciphertextHex,
    expiresAt: Date.now() + ttlMs,
    handle: pkg.handle || undefined,
  }
  return { offer, qrText: encodePairingQr(offer) }
}

export async function resolvePairingPackage(offer: PairingOffer): Promise<PairingPackage> {
  if (offer.v === 2) {
    return decryptPairingPackage(offer.ivHex, offer.ciphertextHex, offer.keyHex)
  }
  const url = `${offer.baseUrl.replace(/\/+$/, '')}/pair/${offer.sessionId}`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Pairing host error (${res.status})`)
  }
  const body = (await res.json()) as { ivHex?: string; ciphertextHex?: string }
  if (!body.ivHex || !body.ciphertextHex) throw new Error('Malformed pairing response')
  return decryptPairingPackage(body.ivHex, body.ciphertextHex, offer.keyHex)
}
