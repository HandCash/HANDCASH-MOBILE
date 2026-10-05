/**
 * App-private file store behind `window.handcash.storageGetSync` /
 * `storageSetSync` (`native-android/DurableStorePlugin.java`).
 *
 * WebView `localStorage` caps at about 5MB per origin whatever the disk holds.
 * With a shell store the core writes there and keeps only values up to 64KB
 * mirrored in `localStorage` — the same split Desktop has with Electron.
 */

export type NativeDurableStore = {
  get(key: string): string | null | undefined
  set(key: string, value: string, allowVaultIdentityReplace: boolean): boolean
  remove(key: string): boolean
  /** JSON array of every held key. */
  keys(): string
}

export type OriginStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>

/** `LOCAL_MIRROR_MAX_BYTES` in Desktop `src/wallet/durableStorage.ts`. */
const LOCAL_MIRROR_MAX_BYTES = 64 * 1024

const DURABLE_PREFIX = 'handcash.'

export function nativeDurableStore(): NativeDurableStore | null {
  if (typeof window === 'undefined') return null
  const store = (window as unknown as { HandcashDurableStore?: NativeDurableStore })
    .HandcashDurableStore
  return store && typeof store.get === 'function' && typeof store.set === 'function'
    ? store
    : null
}

/** The bridge methods the core probes for; `''` deletes, as on Desktop. */
export function durableStoreBridge(store: NativeDurableStore) {
  return {
    storageGetSync: (key: string): string | null => store.get(key) ?? null,
    storageSetSync: (
      key: string,
      value: string,
      opts?: { allowVaultIdentityReplace?: boolean },
    ): boolean =>
      value === ''
        ? store.remove(key)
        : store.set(key, value, opts?.allowVaultIdentityReplace === true),
  }
}

export function nativeDurableKeys(store: NativeDurableStore): string[] {
  try {
    const parsed = JSON.parse(store.keys()) as unknown
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

export type OriginMove = {
  moved: number
  movedBytes: number
  freedBytes: number
  /** File-store copies the one-time recovery replaced with the WebView copy. */
  recovered: number
  /** Stale file-store queue entries the recovery dropped. */
  droppedQueues: number
}

/**
 * Marks the one-time recovery from builds 0.1.592–0.1.603.
 *
 * Those builds imported the core before installing this bridge, and a module
 * read state at import time, so the core settled on WebView storage for the
 * whole session. The file store kept the copy from its first move, and each
 * boot then deleted every large WebView value because the file store "held"
 * it. What WebView storage holds at the first fixed boot is exactly what the
 * last session ran on.
 */
export const ORIGIN_RECOVERED_KEY = 'handcash.durable.originRecovered.v1'

/**
 * Queues whose WebView absence means "drained" in the sessions above. Their
 * file-store copy is months stale: reading it back would resubmit or re-lock
 * entries the wallet already settled.
 */
const DRAINED_WHEN_ABSENT_RE =
  /^handcash\.(?:wallet\.(?:pendingMinerOutbox|utxoLocks)|brc29\.pendingOutbox|item\.pendingOutbox|autoPayReservations)/

/**
 * Move wallet state out of WebView storage into the file store.
 *
 * Copies each `handcash.*` key the file store does not hold, and only once the
 * file store reads it back drops origin copies too large for the core to
 * mirror, so the quota is free for the small-key mirror. A key the file store
 * already holds is authoritative: the core writes there first — except once,
 * on the first boot after {@link ORIGIN_RECOVERED_KEY}'s builds, when the
 * WebView copy wins.
 */
export function moveOriginStorageIntoNative(
  store: NativeDurableStore,
  origin: OriginStorage,
): OriginMove {
  const names: string[] = []
  for (let i = 0; i < origin.length; i++) {
    const key = origin.key(i)
    if (key?.startsWith(DURABLE_PREFIX)) names.push(key)
  }
  const result: OriginMove = {
    moved: 0,
    movedBytes: 0,
    freedBytes: 0,
    recovered: 0,
    droppedQueues: 0,
  }
  const originWins = (store.get(ORIGIN_RECOVERED_KEY) ?? null) == null
  let recoveryComplete = true
  for (const key of names) {
    const value = origin.getItem(key)
    if (value == null || value === '') continue
    const held = store.get(key) ?? null
    if (held == null || (originWins && held !== value)) {
      // The vault the last session unlocked is the WebView one; the store
      // archives the copy it replaces.
      if (!store.set(key, value, held != null) || store.get(key) !== value) {
        if (held != null) recoveryComplete = false
        continue
      }
      if (held == null) {
        result.moved += 1
        result.movedBytes += key.length + value.length
      } else {
        result.recovered += 1
      }
    }
    if (value.length > LOCAL_MIRROR_MAX_BYTES) {
      origin.removeItem(key)
      result.freedBytes += key.length + value.length
    }
  }
  if (!originWins) return result
  const inOrigin = new Set(names)
  for (const key of nativeDurableKeys(store)) {
    if (inOrigin.has(key) || !DRAINED_WHEN_ABSENT_RE.test(key)) continue
    if (store.remove(key)) result.droppedQueues += 1
    else recoveryComplete = false
  }
  if (recoveryComplete) store.set(ORIGIN_RECOVERED_KEY, String(Date.now()), false)
  return result
}
