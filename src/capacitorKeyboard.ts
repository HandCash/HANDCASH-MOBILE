/**
 * Capacitor Keyboard — scroll focused fields; do not resize/shrink the WebView.
 * Android soft input is adjustPan (set in build-apk.sh) so the OS shifts the
 * window up without compressing flex layouts.
 */
import { Capacitor } from '@capacitor/core'

export async function installCapacitorKeyboard(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard')
    const { applyCapacitorKeyboardHeight } = await import(
      '@handcash/wallet-ui/wallet/keyboardInset'
    )
    // setResizeMode / setScroll are iOS-only in @capacitor/keyboard — Android
    // returns UNIMPLEMENTED and pollutes session logs if awaited.
    if (Capacitor.getPlatform() === 'ios') {
      await Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {})
      await Keyboard.setScroll({ isDisabled: false }).catch(() => {})
    }
    void Keyboard.addListener('keyboardWillShow', (info) => {
      applyCapacitorKeyboardHeight(info.keyboardHeight || 0)
    })
    void Keyboard.addListener('keyboardDidShow', (info) => {
      applyCapacitorKeyboardHeight(info.keyboardHeight || 0)
    })
    void Keyboard.addListener('keyboardWillHide', () => {
      applyCapacitorKeyboardHeight(0)
    })
    void Keyboard.addListener('keyboardDidHide', () => {
      applyCapacitorKeyboardHeight(0)
    })
  } catch (err) {
    console.warn('[keyboard] Capacitor Keyboard unavailable', err)
  }
}
