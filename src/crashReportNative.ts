import { Capacitor, registerPlugin } from '@capacitor/core'
import { appendAppLog } from '@desktop/wallet/appLog'

type CrashReportPlugin = {
  takeReport(): Promise<{ report: string }>
}

const Native = registerPlugin<CrashReportPlugin>('CrashReport')

/**
 * Hands the previous run's native deaths (uncaught Java exceptions, lost
 * renderers) to the log ring. The native file is cleared once read.
 */
export async function drainNativeCrashReport(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { report } = await Native.takeReport()
    const entries = report.split(/\n(?=\d{4}-\d{2}-\d{2}T)/).map((e) => e.trim()).filter(Boolean)
    for (const entry of entries) {
      appendAppLog('error', `[native-crash] ${entry.slice(0, 4000)}`)
    }
  } catch (err) {
    appendAppLog(
      'warn',
      `[native-crash] report unreadable: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
