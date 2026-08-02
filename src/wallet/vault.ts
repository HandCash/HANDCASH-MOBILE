/** Minimal mobile vault — password-wrapped root key in localStorage. */
import { PrivateKey } from '@bsv/sdk'

const VAULT_KEY = 'handcash.mobile.vault.v1'

export type MobileVaultRecord = {
  version: 1
  chain: 'main' | 'test'
  handle: string
  identityKey: string
  address: string
  ciphertext: string
  iv: string
  salt: string
}

function toBuf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toBuf(salt), iterations: 210_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function hasVault(): boolean {
  return Boolean(localStorage.getItem(VAULT_KEY))
}

export function readVaultMeta(): Omit<
  MobileVaultRecord,
  'ciphertext' | 'iv' | 'salt'
> | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY)
    if (!raw) return null
    const rec = JSON.parse(raw) as MobileVaultRecord
    return {
      version: rec.version,
      chain: rec.chain,
      handle: rec.handle,
      identityKey: rec.identityKey,
      address: rec.address,
    }
  } catch {
    return null
  }
}

export async function installLinkedVault(args: {
  rootKeyHex: string
  password: string
  handle: string
  identityKey: string
  address: string
  chain: 'main' | 'test'
}): Promise<MobileVaultRecord> {
  if (args.password.length < 10) throw new Error('Password must be at least 10 characters')
  if (!/[a-zA-Z]/.test(args.password) || !/[0-9]/.test(args.password)) {
    throw new Error('Password must include a letter and a number')
  }
  const key = PrivateKey.fromHex(args.rootKeyHex.trim())
  const identityKey = key.toPublicKey().toString()
  if (args.identityKey && args.identityKey !== identityKey) {
    throw new Error('Linked key does not match package identity')
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aes = await deriveKey(args.password, salt)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aes,
    new TextEncoder().encode(args.rootKeyHex.trim().toLowerCase()),
  )
  const record: MobileVaultRecord = {
    version: 1,
    chain: args.chain,
    handle: args.handle || identityKey.slice(0, 12),
    identityKey,
    address: args.address || key.toAddress(),
    ciphertext: bytesToHex(new Uint8Array(cipher)),
    iv: bytesToHex(iv),
    salt: bytesToHex(salt),
  }
  localStorage.setItem(VAULT_KEY, JSON.stringify(record))
  return record
}

export async function unlockVault(password: string): Promise<{
  rootKeyHex: string
  record: MobileVaultRecord
}> {
  const raw = localStorage.getItem(VAULT_KEY)
  if (!raw) throw new Error('No wallet on this device')
  const record = JSON.parse(raw) as MobileVaultRecord
  const aes = await deriveKey(password, hexToBytes(record.salt))
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuf(hexToBytes(record.iv)) },
    aes,
    toBuf(hexToBytes(record.ciphertext)),
  )
  const rootKeyHex = new TextDecoder().decode(plain)
  PrivateKey.fromHex(rootKeyHex)
  return { rootKeyHex, record }
}

export function wipeVault(): void {
  localStorage.removeItem(VAULT_KEY)
  localStorage.removeItem('handcash.mobile.historyBackupUrl')
}

export function getHistoryBackupUrl(): string {
  return localStorage.getItem('handcash.mobile.historyBackupUrl')?.trim() ?? ''
}

export function setHistoryBackupUrl(url: string): void {
  const next = url.trim().replace(/\/+$/, '')
  if (next) localStorage.setItem('handcash.mobile.historyBackupUrl', next)
  else localStorage.removeItem('handcash.mobile.historyBackupUrl')
}
