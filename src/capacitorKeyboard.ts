/**
 * Capacitor Keyboard → CSS inset so sticky bars stay above the soft keyboard.
 */
import { Capacitor } from '@capacitor/core'

export async function installCapacitorKeyboard(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard')
    const { applyCapacitorKeyboardHeight } = await import(
      '@desktop/wallet/keyboardInset'
    )
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body }).catch(() => {})
    await Keyboard.setScroll({ isDisabled: false }).catch(() => {})
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
