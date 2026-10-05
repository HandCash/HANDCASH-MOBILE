/**
 * Side-effect entry imported before the UI core.
 *
 * ES imports evaluate before `main.tsx`'s body, and core modules read durable
 * state at import time. `window.handcash` must exist by then, or those reads
 * go to WebView storage instead of the app file store.
 */
import { installMobileBridge } from './bridge'

installMobileBridge()
