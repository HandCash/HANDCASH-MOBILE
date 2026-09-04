import { registerPlugin } from '@capacitor/core'
import { errMsg } from './nativeResult'

type ShareTextPlugin = {
  share(opts: { title: string; text: string }): Promise<{ ok: boolean }>
}

const Native = registerPlugin<ShareTextPlugin>('ShareText')

export async function nativeShareText(payload: {
  title: string
  text: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await Native.share(payload)
    return result?.ok ? { ok: true } : { ok: false, error: 'share failed' }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}
