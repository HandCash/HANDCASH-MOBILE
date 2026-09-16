/**
 * Capacitor adapter for draft BRC-246. Same `window.handcash` methods Desktop
 * exposes via Electron IPC. Missing plugin → listen returns null and chat
 * stays on the messagebox.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

type ListenResult = { host?: string; port?: number }
type ConnectResult =
  | { ok: true; remoteHello: string; socketId: string }
  | { ok: false; immediate: boolean }

type DirectSessionPlugin = {
  listen(): Promise<ListenResult>
  connect(opts: {
    host: string
    port: number
    timeoutMs: number
    hello: string
  }): Promise<{
    ok?: boolean
    immediate?: boolean
    remoteHello?: string
    socketId?: string
  }>
  send(opts: { socketId: string; body: string; timeoutMs: number }): Promise<{ ok?: boolean }>
  close(opts: { socketId: string }): Promise<void>
  accept(opts: { socketId: string; welcome: string }): Promise<void>
  reject(opts: { socketId: string }): Promise<void>
  addListener(
    eventName: 'hello' | 'message' | 'closed',
    listenerFunc: (event: {
      socketId?: string
      hello?: string
      sender?: string
      body?: string
    }) => void,
  ): Promise<PluginListenerHandle>
}

const Native = registerPlugin<DirectSessionPlugin>('DirectSession')

type HelloHandler = (event: { socketId: string; hello: string }) => void
type MessageHandler = (event: { socketId: string; sender: string; body: string }) => void
type ClosedHandler = (event: { socketId: string }) => void

let helloHandler: HelloHandler | null = null
let messageHandler: MessageHandler | null = null
let closedHandler: ClosedHandler | null = null
let wired = false

function wireNativeEvents(): void {
  if (wired) return
  wired = true
  void Native.addListener('hello', (event) => {
    if (!event.socketId || !event.hello) return
    helloHandler?.({ socketId: event.socketId, hello: event.hello })
  })
  void Native.addListener('message', (event) => {
    if (!event.socketId || !event.sender || !event.body) return
    messageHandler?.({
      socketId: event.socketId,
      sender: event.sender,
      body: event.body,
    })
  })
  void Native.addListener('closed', (event) => {
    if (!event.socketId) return
    closedHandler?.({ socketId: event.socketId })
  })
}

export function nativeDirectSessionApi() {
  wireNativeEvents()
  return {
    directSessionListen: async () => {
      try {
        const result = await Native.listen()
        if (!result?.host || typeof result.port !== 'number') return null
        return { host: result.host, port: result.port }
      } catch {
        return null
      }
    },
    directSessionConnect: async (args: {
      host: string
      port: number
      timeoutMs: number
      hello: string
    }): Promise<ConnectResult> => {
      try {
        const result = await Native.connect(args)
        if (result?.ok && result.remoteHello && result.socketId) {
          return {
            ok: true,
            remoteHello: result.remoteHello,
            socketId: result.socketId,
          }
        }
        return { ok: false, immediate: result?.immediate === true }
      } catch {
        return { ok: false, immediate: true }
      }
    },
    directSessionSend: async (args: {
      socketId: string
      body: string
      timeoutMs: number
    }) => {
      try {
        const result = await Native.send(args)
        return result?.ok === true
      } catch {
        return false
      }
    },
    directSessionClose: async (socketId: string) => {
      try {
        await Native.close({ socketId })
      } catch {
        /* closed */
      }
    },
    directSessionAccept: async (args: { socketId: string; welcome: string }) => {
      try {
        await Native.accept(args)
      } catch {
        /* dropped */
      }
    },
    directSessionReject: async (socketId: string) => {
      try {
        await Native.reject({ socketId })
      } catch {
        /* dropped */
      }
    },
    onDirectSessionHello: (handler: HelloHandler) => {
      helloHandler = handler
      return () => {
        if (helloHandler === handler) helloHandler = null
      }
    },
    onDirectSessionMessage: (handler: MessageHandler) => {
      messageHandler = handler
      return () => {
        if (messageHandler === handler) messageHandler = null
      }
    },
    onDirectSessionClosed: (handler: ClosedHandler) => {
      closedHandler = handler
      return () => {
        if (closedHandler === handler) closedHandler = null
      }
    },
  }
}
