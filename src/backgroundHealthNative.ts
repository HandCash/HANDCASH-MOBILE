import { registerPlugin } from '@capacitor/core'
import { appendAppLog } from '@desktop/wallet/appLog'
import { backgroundStalled, describeBackgroundHealth, type BackgroundHealthReport } from './backgroundHealth'
import { errMsg } from './nativeResult'

type BackgroundHealthPlugin = {
  report(): Promise<BackgroundHealthReport>
  requestUnrestricted(): Promise<{ exempt: boolean; asked: boolean }>
}

const Native = registerPlugin<BackgroundHealthPlugin>('BackgroundHealth')

const EXEMPT_ASKED_KEY = 'handcash.mobile.batteryExemptAsked.v1'

/** Log the native view of the last hidden stretch. Never throws. */
export async function logBackgroundHealth(hiddenMs: number): Promise<void> {
  try {
    const report = await Native.report()
    appendAppLog(backgroundStalled(report) ? 'warn' : 'info', describeBackgroundHealth(report, hiddenMs))
  } catch (err) {
    appendAppLog('warn', `[bg-health] report failed: ${errMsg(err)}`)
  }
}

/** Ask Android once per install to exempt the wallet from battery optimization. */
export async function requestBackgroundExemptionOnce(): Promise<void> {
  try {
    if (localStorage.getItem(EXEMPT_ASKED_KEY)) return
    const result = await Native.requestUnrestricted()
    if (result.asked || result.exempt) localStorage.setItem(EXEMPT_ASKED_KEY, '1')
    appendAppLog('info', `[bg-health] battery exemption exempt=${result.exempt} asked=${result.asked}`)
  } catch (err) {
    appendAppLog('warn', `[bg-health] battery exemption request failed: ${errMsg(err)}`)
  }
}
