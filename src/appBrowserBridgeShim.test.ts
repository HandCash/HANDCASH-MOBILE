import assert from 'node:assert/strict'
import test from 'node:test'
import { APP_BROWSER_BRIDGE_SHIM } from './appBrowserBridgeShim.ts'

type Posted = { id: number; method: string; path: string; body: string }

function tab() {
  const posted: Posted[] = []
  const listeners: Array<(event: { data: string }) => void> = []
  const pageCalls: unknown[] = []
  const window: Record<string, unknown> = {
    handcashBrc100Channel: {
      postMessage: (data: string) => posted.push(JSON.parse(data)),
      addEventListener: (_type: string, fn: (event: { data: string }) => void) => listeners.push(fn),
    },
    fetch: async (input: unknown) => {
      pageCalls.push(input)
      return new Response('page')
    },
  }
  new Function('window', APP_BROWSER_BRIDGE_SHIM)(window)
  const fetch = window.fetch as typeof globalThis.fetch
  const reply = (id: number, status: number, body = '') =>
    listeners.forEach((fn) => fn({ data: JSON.stringify({ id, status, body }) }))
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { window, fetch, posted, pageCalls, reply, flush }
}

test('SDK calls to the loopback bridge ride the tab channel', async () => {
  const t = tab()
  const pending = t.fetch('http://localhost:3321/createAction', {
    method: 'POST',
    headers: { Origin: 'https://market.handcash.io' },
    body: '{"description":"x"}',
  })
  await t.flush()
  assert.deepEqual(t.posted, [{ id: 1, method: 'POST', path: '/createAction', body: '{"description":"x"}' }])
  t.reply(1, 200, '{"txid":"ab"}')
  const response = await pending
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { txid: 'ab' })
  assert.equal(t.pageCalls.length, 0)
})

test('every loopback spelling and port is carried, and errors keep their status', async () => {
  const t = tab()
  const calls = [
    t.fetch('http://127.0.0.1:3321/getPublicKey?x=1', { method: 'POST', body: '{}' }),
    t.fetch(new URL('http://[::1]:3321/isAuthenticated'), { method: 'POST', body: '{}' }),
    t.fetch(new Request('https://localhost:2121/listOutputs', { method: 'POST', body: '{"basket":"1sat"}' })),
  ]
  await t.flush()
  assert.deepEqual(
    t.posted.map((p) => [p.path, p.body]),
    [['/getPublicKey', '{}'], ['/isAuthenticated', '{}'], ['/listOutputs', '{"basket":"1sat"}']],
  )
  t.reply(1, 403, '{"code":"PERMISSION_DENIED"}')
  t.reply(2, 200, '{"authenticated":true}')
  t.reply(3, 204)
  const [denied, ok, empty] = await Promise.all(calls)
  assert.equal(denied.status, 403)
  assert.equal(ok.status, 200)
  assert.equal(empty.status, 204)
})

test('other requests, binary bodies and unknown ports stay on the page fetch', async () => {
  const t = tab()
  await t.fetch('https://api.example.com/data')
  await t.fetch('http://localhost:5173/app.js')
  await t.fetch('http://localhost:3321/createAction', { method: 'POST', body: new Uint8Array([1, 2]) })
  assert.equal(t.posted.length, 0)
  assert.equal(t.pageCalls.length, 3)
})

test('a dead channel rejects like a failed fetch', async () => {
  const t = tab()
  const pending = t.fetch('http://localhost:3321/createAction', { method: 'POST', body: '{}' })
  await t.flush()
  t.reply(1, 0)
  await assert.rejects(pending, TypeError)
})

test('installs once and only where the channel exists', () => {
  const t = tab()
  const patched = t.window.fetch
  new Function('window', APP_BROWSER_BRIDGE_SHIM)(t.window)
  assert.equal(t.window.fetch, patched)

  const bare: Record<string, unknown> = { fetch: () => undefined }
  const original = bare.fetch
  new Function('window', APP_BROWSER_BRIDGE_SHIM)(bare)
  assert.equal(bare.fetch, original)
})
