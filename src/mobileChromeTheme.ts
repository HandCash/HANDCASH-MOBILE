import { Capacitor } from '@capacitor/core'
import {
  HANDCASH_DARK_PALETTE,
  HANDCASH_LIGHT_PALETTE,
  type ResolvedColorMode,
} from '@handcash/wallet-ui/wallet/handcashTheme'
import {
  resolveColorMode,
  subscribeAppearance,
} from '@handcash/wallet-ui/wallet/themePrefs'

const CHROME_BG: Record<ResolvedColorMode, string> = {
  light: HANDCASH_LIGHT_PALETTE.bg,
  dark: HANDCASH_DARK_PALETTE.bg,
}

const THEME_COLOR_META_ID = 'hc-theme-color'

function syncThemeColorMeta(color: string): void {
  let meta = document.getElementById(THEME_COLOR_META_ID) as HTMLMetaElement | null
  if (!meta) {
    meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
  }
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.id = THEME_COLOR_META_ID
    document.head.appendChild(meta)
  }
  meta.removeAttribute('media')
  meta.setAttribute('content', color)
}

async function syncNativeChrome(mode: ResolvedColorMode, color: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setBackgroundColor({ color })
    // `Style` names the background the bar sits on, not the icon colour:
    // `Style.Light` draws dark icons for a light sheet, `Style.Dark` draws light
    // icons for the black sheet. Reading them as icon colours inverts both modes.
    await StatusBar.setStyle({
      style: mode === 'light' ? Style.Light : Style.Dark,
    })
    await StatusBar.show()
  } catch {
    // Dev browser / plugin not wired — meta theme-color still updates.
  }
}

function syncMobileChromeTheme(mode: ResolvedColorMode): void {
  const color = CHROME_BG[mode]
  syncThemeColorMeta(color)
  void syncNativeChrome(mode, color)
}

/** Android status bar + browser chrome — follows Settings appearance. */
export function startMobileChromeTheme(): () => void {
  syncMobileChromeTheme(resolveColorMode())
  return subscribeAppearance((_pref, resolved) => syncMobileChromeTheme(resolved))
}
