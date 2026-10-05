import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  durableStoreBridge,
  moveOriginStorageIntoNative,
  ORIGIN_RECOVERED_KEY,
  type NativeDurableStore,
  type OriginStorage,
} from './durableStoreNative.ts'

function memoryNative(seed: Record<string, string> = {}, refuse = new Set<string>()) {
  const held = new Map(Object.entries(seed))
  const store: NativeDurableStore = {
    get: (key) => held.get(key) ?? null,
    set: (key, value) => {
      if (refuse.has(key)) return false
      held.set(key, value)
      return true
    },
    remove: (key) => held.delete(key) || true,
    keys: () => JSON.stringify([...held.keys()]),
  }
  return { store, held }
}

function memoryOrigin(seed: Record<string, string>) {
  const held = new Map(Object.entries(seed))
  const origin: OriginStorage = {
    get length() {
      return held.size
    },
    key: (i) => [...held.keys()][i] ?? null,
    getItem: (key) => held.get(key) ?? null,
    removeItem: (key) => {
      held.delete(key)
    },
  }
  return { origin, held }
}

const big = 'x'.repeat(64 * 1024 + 1)

test('moves wallet keys into the file store and frees the large origin copies', () => {
  const { store, held: native } = memoryNative()
  const { origin, held: local } = memoryOrigin({
    'handcash.wallet.signedChequeArchive.v1': big,
    'handcash.appearance': 'dark',
    'capacitor.unrelated': 'keep',
  })

  const result = moveOriginStorageIntoNative(store, origin)

  assert.equal(result.moved, 2)
  assert.equal(native.get('handcash.wallet.signedChequeArchive.v1'), big)
  assert.equal(native.get('handcash.appearance'), 'dark')
  assert.equal(native.has('capacitor.unrelated'), false)
  assert.equal(local.has('handcash.wallet.signedChequeArchive.v1'), false)
  assert.equal(local.get('handcash.appearance'), 'dark')
  assert.equal(local.get('capacitor.unrelated'), 'keep')
})

test('keeps the origin copy when the file store refuses it', () => {
  const { store } = memoryNative({}, new Set(['handcash.createdBeef.aa']))
  const { origin, held: local } = memoryOrigin({ 'handcash.createdBeef.aa': big })

  assert.equal(moveOriginStorageIntoNative(store, origin).moved, 0)
  assert.equal(local.get('handcash.createdBeef.aa'), big)
})

test('never overwrites what the file store already holds once recovered', () => {
  const { store, held: native } = memoryNative({
    [ORIGIN_RECOVERED_KEY]: '1',
    'handcash.brc100.appActivity': 'newer',
    'handcash.wallet.pendingMinerOutbox.v1': 'queued',
  })
  const { origin, held: local } = memoryOrigin({ 'handcash.brc100.appActivity': big })

  const result = moveOriginStorageIntoNative(store, origin)
  assert.equal(result.moved, 0)
  assert.equal(result.recovered, 0)
  assert.equal(native.get('handcash.brc100.appActivity'), 'newer')
  assert.equal(native.get('handcash.wallet.pendingMinerOutbox.v1'), 'queued')
  assert.equal(local.has('handcash.brc100.appActivity'), false)
})

test('first fixed boot: the WebView copy the last session ran on wins, once', () => {
  const suffix = ':wallet:main:0:root'
  const { store, held: native } = memoryNative({
    [`handcash.tokens.list.v1${suffix}`]: 'first-move copy',
    'handcash.brc100.vault.v1': '{"identityKey":"a","accounts":1}',
    [`handcash.wallet.pendingMinerOutbox.v1${suffix}`]: 'settled months ago',
    [`handcash.brc150.remittance.v1${suffix}`]: 'only the file store has this',
  })
  const allowed: string[] = []
  const set = store.set
  store.set = (key, value, allow) => {
    if (allow) allowed.push(key)
    return set(key, value, allow)
  }
  const { origin, held: local } = memoryOrigin({
    [`handcash.tokens.list.v1${suffix}`]: big,
    'handcash.brc100.vault.v1': '{"identityKey":"a","accounts":4}',
  })

  const result = moveOriginStorageIntoNative(store, origin)

  assert.equal(result.recovered, 2)
  assert.equal(result.droppedQueues, 1)
  assert.equal(native.get(`handcash.tokens.list.v1${suffix}`), big)
  assert.equal(native.get('handcash.brc100.vault.v1'), '{"identityKey":"a","accounts":4}')
  // Replacing a held vault may cross the identity guard; the store archives it.
  assert.deepEqual(allowed.sort(), ['handcash.brc100.vault.v1', `handcash.tokens.list.v1${suffix}`].sort())
  assert.equal(native.has(`handcash.wallet.pendingMinerOutbox.v1${suffix}`), false)
  assert.equal(native.get(`handcash.brc150.remittance.v1${suffix}`), 'only the file store has this')
  assert.equal(local.has(`handcash.tokens.list.v1${suffix}`), false)
  assert.ok(native.has(ORIGIN_RECOVERED_KEY))

  // The next boot is back to file-store-authoritative.
  local.set('handcash.brc100.vault.v1', '{"identityKey":"a","accounts":1}')
  assert.equal(moveOriginStorageIntoNative(store, origin).recovered, 0)
  assert.equal(native.get('handcash.brc100.vault.v1'), '{"identityKey":"a","accounts":4}')
})

test('a refused recovery write retries on the next boot', () => {
  const key = 'handcash.messages.v1:wallet:main:0:root'
  const { store, held: native } = memoryNative({ [key]: 'stale' }, new Set([key]))
  const { origin } = memoryOrigin({ [key]: 'current' })

  assert.equal(moveOriginStorageIntoNative(store, origin).recovered, 0)
  assert.equal(native.get(key), 'stale')
  assert.equal(native.has(ORIGIN_RECOVERED_KEY), false)
})

test('an empty write deletes and the vault flag reaches the store', () => {
  const calls: string[] = []
  const store: NativeDurableStore = {
    get: () => null,
    set: (key, _value, allow) => {
      calls.push(`set ${key} ${allow}`)
      return true
    },
    remove: (key) => {
      calls.push(`remove ${key}`)
      return true
    },
    keys: () => '[]',
  }
  const bridge = durableStoreBridge(store)
  bridge.storageSetSync('handcash.brc100.vault.v1', '{}', { allowVaultIdentityReplace: true })
  bridge.storageSetSync('handcash.messages.v1', '')
  assert.deepEqual(calls, ['set handcash.brc100.vault.v1 true', 'remove handcash.messages.v1'])
  assert.equal(bridge.storageGetSync('missing'), null)
})
