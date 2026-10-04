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

export type OriginMove = { moved: number; movedBytes: number; freedBytes: number }

/**
 * Move wallet state out of WebView storage into the file store.
 *
 * Copies each `handcash.*` key the file store does not hold, and only once the
 * file store reads it back drops origin copies too large for the core to
 * mirror, so the quota is free for the small-key mirror. A key the file store
 * already holds is authoritative: the core writes there first.
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
  const result: OriginMove = { moved: 0, movedBytes: 0, freedBytes: 0 }
  for (const key of names) {
    const value = origin.getItem(key)
    if (value == null || value === '') continue
    if ((store.get(key) ?? null) == null) {
      if (!store.set(key, value, false) || store.get(key) !== value) continue
      result.moved += 1
      result.movedBytes += key.length + value.length
    }
    if (value.length > LOCAL_MIRROR_MAX_BYTES) {
      origin.removeItem(key)
      result.freedBytes += key.length + value.length
    }
  }
  return result
}
