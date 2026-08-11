import { registerPlugin } from '@capacitor/core'

type SaveImagePlugin = {
  saveToGallery(opts: {
    filename: string
    mime: string
    base64: string
  }): Promise<{ ok: boolean; uri?: string }>
}

const Native = registerPlugin<SaveImagePlugin>('SaveImage')

export async function nativeSaveImageToGallery(opts: {
  filename: string
  mime: string
  base64: string
}): Promise<{ ok: true; path?: string } | { ok: false; error: string }> {
  try {
    const result = await Native.saveToGallery(opts)
    if (!result?.ok) return { ok: false, error: 'gallery save failed' }
    return { ok: true, path: result.uri }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
