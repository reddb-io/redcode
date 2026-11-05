import { decodePersistentPtyMessage, persistentPtyFrame } from "@opencode/client/solid"
import { Option } from "effect"

type Size = { cols: number; rows: number }
type Step = { type: "output"; data: Uint8Array } | { type: "resize"; size: Size } | { type: "ready" }
const MAX_BUFFER = 4 * 1024 * 1024
const MAX_INPUT = 64 * 1024
const MAX_STEPS = 1024

/** Serializes the server's replay, checkpoints and live output before accepting terminal input. */
export function persistentConnection(input: {
  attachmentID: string
  write: (data: Uint8Array, done: VoidFunction) => void
  resize: (size: Size) => void
  send: (frame: Uint8Array) => void
  overflow: VoidFunction
  incompatible: VoidFunction
}) {
  const encoder = new TextEncoder()
  const queue: Step[] = []
  const pending: Uint8Array[] = []
  let buffered = 0
  let pendingBytes = 0
  let writing = false
  let applyingOutput = false
  let attached = false
  let controller = false
  let restored = false
  let wantsControl = false
  let stopped = false
  let generation = 0
  let desired: Size | undefined
  let canonical: Size | undefined

  const sendInput = (bytes: Uint8Array) => {
    if (stopped) return
    if (!restored || !attached) {
      if (pendingBytes + bytes.byteLength > MAX_INPUT) return input.overflow()
      pending.push(bytes)
      pendingBytes += bytes.byteLength
      return
    }
    const size = desired ?? canonical
    if (size) input.send(persistentPtyFrame(size, bytes))
  }
  const interact = () => {
    if (!attached || !restored) {
      wantsControl = true
      return
    }
    if (desired) input.send(persistentPtyFrame(desired))
  }
  const run = () => {
    if (writing || stopped) return
    while (queue.length) {
      const next = queue.shift()
      if (!next) return
      if (next.type === "resize") {
        canonical = next.size
        input.resize(next.size)
        continue
      }
      if (next.type === "ready") {
        restored = true
        const queued = pending.splice(0)
        pendingBytes = 0
        queued.forEach(sendInput)
        if (!queued.length && (controller || wantsControl)) interact()
        wantsControl = false
        continue
      }
      writing = true
      applyingOutput = true
      const current = generation
      input.write(next.data, () => {
        if (stopped) return
        if (current === generation) buffered -= next.data.byteLength
        writing = false
        run()
      })
      applyingOutput = false
      return
    }
  }
  const push = (step: Step) => {
    if (stopped) return
    if (queue.length >= MAX_STEPS) return input.overflow()
    if (step.type === "output") {
      if (buffered + step.data.byteLength > MAX_BUFFER) return input.overflow()
      buffered += step.data.byteLength
    }
    queue.push(step)
    run()
  }
  const checkpoint = (value: string, reset: boolean) => {
    try {
      const data = atob(value)
      const prefix = reset ? new Uint8Array([27, 99]) : new Uint8Array()
      const bytes = new Uint8Array(prefix.length + data.length)
      bytes.set(prefix)
      for (let i = 0; i < data.length; i++) bytes[prefix.length + i] = data.charCodeAt(i)
      push({ type: "output", data: bytes })
    } catch {
      input.incompatible()
    }
  }
  return {
    restore(snapshot: { size: Size; checkpoint: string }) {
      push({ type: "resize", size: snapshot.size })
      checkpoint(snapshot.checkpoint, true)
    },
    output(data: Uint8Array) {
      push({ type: "output", data })
    },
    message(text: string) {
      const decoded = decodePersistentPtyMessage(text)
      if (Option.isNone(decoded)) return
      const message = decoded.value
      if (message.type === "attached") {
        if (message.inputProtocol !== 1) return input.incompatible()
        attached = true
        controller = message.role === "controller"
        push({ type: "resize", size: message.info.size })
        return
      }
      if (message.type === "resized") {
        push({ type: "resize", size: { cols: message.cols, rows: message.rows } })
        checkpoint(message.checkpoint, true)
        return
      }
      if (message.type === "replay_complete") return push({ type: "ready" })
      if (message.type !== "controller_changed") return
      const previous = controller
      controller = message.attachmentID === input.attachmentID
      if (controller && !previous && restored) interact()
    },
    input(value: string) {
      if (applyingOutput) return
      sendInput(encoder.encode(value))
    },
    size(size: Size) {
      if (desired?.cols === size.cols && desired.rows === size.rows) return
      desired = size
      if (controller && restored) interact()
    },
    interact,
    reconnect() {
      generation++
      queue.length = 0
      buffered = 0
      attached = false
      controller = false
      restored = false
    },
    dispose() {
      stopped = true
      generation++
      queue.length = 0
      pending.length = 0
    },
  }
}
