import { wire, type Frame, type Wire } from "../harness-wire"

type Subscriber = {
  exit(detail: string): void
  frame(value: Frame): void
}

type RuntimeProcess = {
  generation: string
  idleTimeoutMs: number
  idleTimer?: ReturnType<typeof setTimeout>
  idleUntil?: number
  initialization?: Promise<void>
  label: string
  reusable: boolean
  signature: string
  subscribers: Map<string, Subscriber>
  wire: Wire
}

export type AgentRuntimeHandle = {
  created: boolean
  generation: string
  initialize(operation: () => Promise<void>): Promise<void>
  release(): Promise<void>
  wire: Wire
}

export function createAgentRuntimeSupervisor() {
  const processes = new Map<string, RuntimeProcess>()

  return {
    acquire(input: {
      args: string[]
      directory: string
      environment?: Record<string, string>
      executable: string
      idleTimeoutMs?: number
      key: string
      label?: string
      owner: string
      reusable: boolean
      subscriber: Subscriber
    }): AgentRuntimeHandle {
      const signature = JSON.stringify([
        input.executable,
        input.args,
        input.directory,
        Object.entries(input.environment ?? {}).sort(([left], [right]) => left.localeCompare(right)),
      ])
      const current = processes.get(input.key)
      if (current && !input.reusable) throw new Error("Agent runtime process is already active")
      if (current && current.signature !== signature)
        throw new Error("A reusable agent runtime cannot change its executable, arguments or directory")
      if (current) {
        current.idleTimeoutMs = input.idleTimeoutMs ?? 0
        return attach(input.key, current, input.owner, input.subscriber)
      }

      const subscribers = new Map([[input.owner, input.subscriber]])
      const generation = crypto.randomUUID()
      const connection = wire({
        executable: input.executable,
        args: input.args,
        directory: input.directory,
        environment: input.environment,
        frame: (value) => subscribers.forEach((subscriber) => subscriber.frame(value)),
        exit: (detail) => {
          const process = processes.get(input.key)
          if (!process || process.generation !== generation) return
          if (process.idleTimer) clearTimeout(process.idleTimer)
          processes.delete(input.key)
          const current = [...subscribers.values()]
          subscribers.clear()
          current.forEach((subscriber) => subscriber.exit(detail))
        },
      })
      const process = {
        generation,
        idleTimeoutMs: input.idleTimeoutMs ?? 0,
        label: input.label ?? input.key,
        reusable: input.reusable,
        signature,
        subscribers,
        wire: connection,
      }
      processes.set(input.key, process)
      return handle(input.key, process, input.owner, true)
    },
    async evict(key: string) {
      const process = processes.get(key)
      if (!process) return false
      processes.delete(key)
      if (process.idleTimer) clearTimeout(process.idleTimer)
      process.subscribers.clear()
      await process.wire.close()
      return true
    },
    async dispose() {
      const current = [...processes.values()]
      processes.clear()
      current.forEach((process) => {
        if (process.idleTimer) clearTimeout(process.idleTimer)
        process.subscribers.clear()
      })
      await Promise.all(current.map((process) => process.wire.close()))
    },
    snapshot() {
      return [...processes.entries()].map(([key, process]) => ({
        key,
        label: process.label,
        generation: process.generation,
        owners: [...process.subscribers.keys()],
        pid: process.wire.pid,
        reusable: process.reusable,
        idleUntil: process.idleUntil,
      }))
    },
  }

  function attach(key: string, process: RuntimeProcess, owner: string, subscriber: Subscriber) {
    if (!process.reusable) throw new Error("Agent runtime process does not support multiple owners")
    if (process.subscribers.has(owner)) throw new Error("Agent runtime owner is already attached")
    if (process.idleTimer) clearTimeout(process.idleTimer)
    process.idleTimer = undefined
    process.idleUntil = undefined
    process.subscribers.set(owner, subscriber)
    return handle(key, process, owner, false)
  }

  function handle(key: string, process: RuntimeProcess, owner: string, created: boolean): AgentRuntimeHandle {
    return {
      created,
      generation: process.generation,
      async initialize(operation) {
        const current = processes.get(key)
        if (!current || current.generation !== process.generation)
          throw new Error("Agent runtime process is unavailable")
        current.initialization ??= operation()
        await current.initialization
      },
      wire: process.wire,
      async release() {
        const current = processes.get(key)
        if (!current || current.generation !== process.generation || !current.subscribers.delete(owner)) return
        if (current.reusable && current.subscribers.size) return
        if (current.reusable && current.idleTimeoutMs > 0) {
          current.idleUntil = Date.now() + current.idleTimeoutMs
          current.idleTimer = setTimeout(() => void closeIdle(key, current), current.idleTimeoutMs)
          current.idleTimer.unref?.()
          return
        }
        processes.delete(key)
        current.subscribers.clear()
        await current.wire.close()
      },
    }
  }

  async function closeIdle(key: string, process: RuntimeProcess) {
    const current = processes.get(key)
    if (!current || current.generation !== process.generation || current.subscribers.size) return
    processes.delete(key)
    current.idleTimer = undefined
    current.idleUntil = undefined
    await current.wire.close()
  }
}
