import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  durableStoreBridge,
  moveOriginStorageIntoNative,
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

test('never overwrites what the file store already holds', () => {
  const { store, held: native } = memoryNative({ 'handcash.brc100.appActivity': 'newer' })
  const { origin, held: local } = memoryOrigin({ 'handcash.brc100.appActivity': big })

  assert.equal(moveOriginStorageIntoNative(store, origin).moved, 0)
  assert.equal(native.get('handcash.brc100.appActivity'), 'newer')
  assert.equal(local.has('handcash.brc100.appActivity'), false)
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
