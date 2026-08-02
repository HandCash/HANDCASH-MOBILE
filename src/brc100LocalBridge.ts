import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

type NativeRequest = {
  requestId: number
  method: string
  path: string
  headers: Record<string, string>
  body: string
}

type Brc100LocalBridgePlugin = {
  start(): Promise<{ httpUrl: string; alreadyRunning?: boolean }>
  stop(): Promise<void>
  respond(options: { requestId: number; status: number; body: string }): Promise<void>
  addListener(
    eventName: 'brc100Request',
    listenerFunc: (event: NativeRequest) => void,
  ): Promise<PluginListenerHandle>
}

const Native = registerPlugin<Brc100LocalBridgePlugin>('Brc100LocalBridge')

export async function startNativeBrc100Bridge(): Promise<string | null> {
  try {
    const res = await Native.start()
    return res.httpUrl
  } catch (err) {
    console.warn('[brc100] native bridge start failed', err)
    return null
  }
}

export async function stopNativeBrc100Bridge(): Promise<void> {
  try {
    await Native.stop()
  } catch {
    // ignore
  }
}

export function onNativeBrc100Request(
  handler: (event: NativeRequest) => void,
): () => void {
  let handle: PluginListenerHandle | undefined
  void Native.addListener('brc100Request', handler).then((h) => {
    handle = h
  })
  return () => {
    void handle?.remove()
  }
}

export async function respondNativeBrc100(options: {
  requestId: number
  status: number
  body: string
}): Promise<void> {
  await Native.respond(options)
}
