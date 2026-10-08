import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { backgroundStalled, describeBackgroundHealth } from './backgroundHealth.ts'

describe('describeBackgroundHealth', () => {
  const at = Date.parse('2026-10-08T23:22:40Z')

  it('names a CPU sleep apart from a process freeze, with the power state', () => {
    const report = {
      events: [
        { at, what: 'screen-off' },
        { at: at + 540_000, what: 'tick-gap', detail: 'late=520000ms asleep=515000ms' },
      ],
      interactive: true,
      powerSave: false,
      exempt: false,
      standbyBucket: 10,
    }
    assert.equal(backgroundStalled(report), true)
    assert.equal(
      describeBackgroundHealth(report, 603_000),
      '[bg-health] hidden 603s · 23:22:40 screen-off · 23:31:40 tick-gap late=520000ms asleep=515000ms · exempt=no bucket=active',
    )
  })

  it('reports a clean hidden stretch without a stall', () => {
    const report = { events: [], interactive: true, powerSave: true, exempt: true, backgroundRestricted: true }
    assert.equal(backgroundStalled(report), false)
    assert.equal(
      describeBackgroundHealth(report, 12_400),
      '[bg-health] hidden 12s · no native events · exempt=yes restricted=yes powerSave=on',
    )
  })
})
