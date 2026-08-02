/** Minimal mobile vault — password-wrapped root key in localStorage. */
import { Mnemonic, PrivateKey } from '@bsv/sdk'

const VAULT_KEY = 'handcash.mobile.vault.v1'
const HISTORY_KEY = 'handcash.mobile.historyBackupUrl'

export type MobileVaultRecord = {
  version: 1
  chain: 'main' | 'test'
  handle: string
  identityKey: string
  address: string
  ciphertext: string
  iv: string
  salt: string
  hasMnemonic?: boolean
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

function validatePassword(password: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters'
  if (!/[a-zA-Z]/.test(password)) return 'Password must include a letter'
  if (!/[0-9]/.test(password)) return 'Password must include a number'
  return null
}

/** BRC-75-style: SHA-256(BIP39 seed) as master key. */
async function rootFromMnemonic(mnemonic: string, passphrase = ''): Promise<string> {
  const m = Mnemonic.fromString(mnemonic.trim().toLowerCase().replace(/\s+/g, ' '))
  const seed = m.toSeed(passphrase)
  const digest = await crypto.subtle.digest('SHA-256', toBuf(new Uint8Array(seed)))
  return bytesToHex(new Uint8Array(digest))
}

async function persistRoot(args: {
  rootKeyHex: string
  password: string
  handle?: string
  chain?: 'main' | 'test'
  hasMnemonic?: boolean
}): Promise<MobileVaultRecord> {
  const pwError = validatePassword(args.password)
  if (pwError) throw new Error(pwError)
  const key = PrivateKey.fromHex(args.rootKeyHex.trim())
  const identityKey = key.toPublicKey().toString()
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
    chain: args.chain ?? 'main',
    handle: args.handle || identityKey.slice(0, 12),
    identityKey,
    address: key.toAddress(),
    ciphertext: bytesToHex(new Uint8Array(cipher)),
    iv: bytesToHex(iv),
    salt: bytesToHex(salt),
    hasMnemonic: args.hasMnemonic,
  }
  localStorage.setItem(VAULT_KEY, JSON.stringify(record))
  return record
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
      hasMnemonic: rec.hasMnemonic,
    }
  } catch {
    return null
  }
}

export async function createVault(password: string): Promise<MobileVaultRecord> {
  const key = PrivateKey.fromRandom()
  return persistRoot({ rootKeyHex: key.toHex(), password, hasMnemonic: false })
}

export async function restoreFromMnemonic(args: {
  mnemonic: string
  password: string
  passphrase?: string
}): Promise<MobileVaultRecord> {
  const rootKeyHex = await rootFromMnemonic(args.mnemonic, args.passphrase ?? '')
  return persistRoot({ rootKeyHex, password: args.password, hasMnemonic: true })
}

export async function restoreFromRootKey(args: {
  rootKeyHex: string
  password: string
  handle?: string
  chain?: 'main' | 'test'
}): Promise<MobileVaultRecord> {
  return persistRoot({
    rootKeyHex: args.rootKeyHex,
    password: args.password,
    handle: args.handle,
    chain: args.chain,
    hasMnemonic: false,
  })
}

export async function installLinkedVault(args: {
  rootKeyHex: string
  password: string
  handle: string
  identityKey: string
  address: string
  chain: 'main' | 'test'
}): Promise<MobileVaultRecord> {
  const key = PrivateKey.fromHex(args.rootKeyHex.trim())
  const identityKey = key.toPublicKey().toString()
  if (args.identityKey && args.identityKey !== identityKey) {
    throw new Error('Linked key does not match package identity')
  }
  return persistRoot({
    rootKeyHex: args.rootKeyHex,
    password: args.password,
    handle: args.handle || identityKey.slice(0, 12),
    chain: args.chain,
    hasMnemonic: false,
  })
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
  localStorage.removeItem(HISTORY_KEY)
}

export function getHistoryBackupUrl(): string {
  return localStorage.getItem(HISTORY_KEY)?.trim() ?? ''
}

export function setHistoryBackupUrl(url: string): void {
  const next = url.trim().replace(/\/+$/, '')
  if (next) localStorage.setItem(HISTORY_KEY, next)
  else localStorage.removeItem(HISTORY_KEY)
}
