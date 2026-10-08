export type BackgroundHealthEvent = { at: number; what: string; detail?: string }

export type BackgroundHealthReport = {
  events: BackgroundHealthEvent[]
  interactive: boolean
  powerSave: boolean
  /** Exempt from battery optimization: Doze honours the wake lock. */
  exempt: boolean
  doze?: boolean
  standbyBucket?: number
  backgroundRestricted?: boolean
}

/** `UsageStatsManager.STANDBY_BUCKET_*`. */
const STANDBY_BUCKETS: Record<number, string> = {
  5: 'exempted',
  10: 'active',
  20: 'working',
  30: 'frequent',
  40: 'rare',
  45: 'restricted',
  50: 'never',
}

/** The app-process tick ran late: the CPU slept or this process was frozen. */
export function backgroundStalled(report: BackgroundHealthReport): boolean {
  return report.events.some((e) => e.what === 'tick-gap')
}

/** One log line: what Android did while the wallet was off screen. */
export function describeBackgroundHealth(report: BackgroundHealthReport, hiddenMs: number): string {
  const clock = (at: number) => new Date(at).toISOString().slice(11, 19)
  const events = report.events.map((e) => `${clock(e.at)} ${e.what}${e.detail ? ` ${e.detail}` : ''}`)
  const state = [`exempt=${report.exempt ? 'yes' : 'no'}`]
  if (report.standbyBucket != null) {
    state.push(`bucket=${STANDBY_BUCKETS[report.standbyBucket] ?? report.standbyBucket}`)
  }
  if (report.backgroundRestricted) state.push('restricted=yes')
  if (report.powerSave) state.push('powerSave=on')
  return (
    `[bg-health] hidden ${Math.round(hiddenMs / 1000)}s · ` +
    `${events.length > 0 ? events.join(' · ') : 'no native events'} · ${state.join(' ')}`
  )
}
