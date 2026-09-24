import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { resolve } from 'node:path'

const runtime = readFileSync(
  resolve(import.meta.dirname, 'backgroundRuntime.ts'),
  'utf8',
)

describe('mobile notification runtime', () => {
  it('posts immediate notifications without exact-alarm scheduling', () => {
    assert.doesNotMatch(runtime, /allowWhileIdle/)
    assert.doesNotMatch(runtime, /schedule:\s*\{\s*at:/)
    assert.match(runtime, /LocalNotifications\.schedule/)
  })

  it('does not silently discard native delivery failures', () => {
    assert.match(runtime, /\[mobile-notifications\] \$\{label\} failed/)
    assert.match(runtime, /\[mobile-notifications\] posted channel=/)
    assert.match(runtime, /localNotificationReceived/)
  })

  it('uses versioned Android channels with audible receive defaults', () => {
    assert.match(runtime, /handcash-receive-v2/)
    assert.match(runtime, /sound: 'default'/)
  })

  it('posts completed spends through the wallet activity channel', () => {
    assert.match(runtime, /addEventListener\('handcash:spend'/)
    assert.match(runtime, /runNotification\('spend'/)
    assert.match(runtime, /kind: 'spend'/)
  })

  it('initializes lifecycle state before suppressing foreground notices', () => {
    assert.match(runtime, /CapacitorApp\.getState\(\)/)
    assert.match(runtime, /appActive = isActive/)
  })
})
