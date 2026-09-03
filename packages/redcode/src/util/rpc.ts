type Definition = {
  [method: string]: (input: any) => any
}

export class RpcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RpcError"
  }
}

function describe(error: unknown) {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`
  return String(error)
}

export function listen(rpc: Definition) {
  onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type !== "rpc.request") return
    try {
      const handler = rpc[parsed.method]
      if (typeof handler !== "function") throw new Error(`Unknown RPC method: ${parsed.method}`)
      const result = await handler(parsed.input)
      postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
    } catch (error) {
      // Without this the caller's promise is never settled and the UI freezes with no
      // message — a thrown handler has to reach the caller as a failure, not as silence.
      postMessage(JSON.stringify({ type: "rpc.error", error: describe(error), id: parsed.id }))
    }
  }
}

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0
  let failure: Error | undefined
  target.onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.result") {
      const entry = pending.get(parsed.id)
      if (entry) {
        pending.delete(parsed.id)
        entry.resolve(parsed.result)
      }
    }
    if (parsed.type === "rpc.error") {
      const entry = pending.get(parsed.id)
      if (entry) {
        pending.delete(parsed.id)
        entry.reject(new RpcError(parsed.error))
      }
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
        }
      }
    }
  }
  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      if (failure) return Promise.reject(failure)
      const requestId = id++
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject })
        target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
      })
    },
    /**
     * The other end is gone. Everything waiting on it has to fail now: a worker that dies
     * or fails to load posts nothing, and a pending call would otherwise wait forever.
     */
    fail(reason: string) {
      failure = new RpcError(reason)
      const waiting = [...pending.values()]
      pending.clear()
      for (const entry of waiting) entry.reject(failure)
    },
    on<Data>(event: string, handler: (data: Data) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers!.delete(handler)
      }
    },
  }
}

export * as Rpc from "./rpc"
