import { createInterface } from "node:readline"
import spawn from "cross-spawn"
import { z } from "zod"
import type { ChildProcess } from "node:child_process"

export const object = (input: unknown) => {
  const result = z.record(z.string(), z.json()).safeParse(input)
  return result.success ? result.data : {}
}
export const string = (input: unknown) => (typeof input === "string" ? input : "")
export type Frame = ReturnType<typeof object>

export async function stopOwnedProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()))
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true })
    await new Promise<void>((resolve) => {
      killer.once("error", () => resolve())
      killer.once("close", () => resolve())
    })
  }
  if (child.exitCode === null && child.signalCode === null) child.kill()
  await closed
}

/** One owned process, literal argv and line-delimited protocol; never accepts shell command text. */
export function wire(input: {
  executable: string
  args: string[]
  directory: string
  frame: (frame: Frame) => void
  exit: (detail: string) => void
}) {
  const child = spawn(input.executable, input.args, { cwd: input.directory, windowsHide: true, stdio: "pipe" })
  const stdin = child.stdin
  const stdout = child.stdout
  const stderr = child.stderr
  if (!stdin || !stdout || !stderr) throw new Error("Harness protocol pipes are unavailable")
  const pending = new Map<
    string,
    { resolve: (value: Frame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()
  const state = { closed: false, stderr: "" }
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()))
  const send = (frame: Frame) => {
    if (state.closed || !stdin.writable) throw new Error("Harness process is unavailable")
    stdin.write(JSON.stringify(frame) + "\n")
  }
  const finish = (detail: string) => {
    if (state.closed) return
    state.closed = true
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(new Error(detail))
    }
    pending.clear()
    input.exit(detail)
  }
  child.on("error", (error) => finish(error.message))
  stdin.on("error", (error) => finish(error.message))
  child.on("exit", (code, signal) =>
    finish(`Harness exited (${signal ?? code ?? "unknown"})${state.stderr ? ": " + state.stderr : ""}`),
  )
  stderr.on("data", (data: Buffer) => {
    state.stderr = (state.stderr + data.toString()).slice(-2000)
  })
  const lines = createInterface({ input: stdout })
  lines.on("line", (line) => {
    // CLI frames are the sole untyped boundary. Malformed output cannot become an approval.
    const result = z.record(z.string(), z.json()).safeParse(
      (() => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })(),
    )
    if (!result.success) return
    const frame = result.data
    const response = frame.type === "control_response" ? object(frame.response) : frame
    const key = String(response.request_id ?? response.id ?? "")
    const item = pending.get(key)
    if (item && ("result" in frame || "error" in frame || frame.type === "control_response")) {
      clearTimeout(item.timer)
      pending.delete(key)
      const error = frame.error ?? response.error
      if (error || response.subtype === "error")
        item.reject(new Error(string(object(error).message) || string(error) || "Harness rejected the request"))
      else item.resolve(object(frame.result ?? response.response))
      return
    }
    input.frame(frame)
  })
  return {
    send,
    request(method: string, params: Frame, driver: "codex" | "claude") {
      const id = crypto.randomUUID()
      return new Promise<Frame>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Harness request timed out: ${method}`))
        }, 30_000)
        pending.set(id, { resolve, reject, timer })
        try {
          send(
            driver === "codex"
              ? { id, method, params }
              : { type: "control_request", request_id: id, request: { subtype: method, ...params } },
          )
        } catch (error) {
          clearTimeout(timer)
          pending.delete(id)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    async close() {
      stdin.end()
      await stopOwnedProcess(child)
      await closed
      lines.close()
    },
  }
}
export type Wire = ReturnType<typeof wire>
