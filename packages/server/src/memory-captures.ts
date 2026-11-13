import { randomUUID } from "node:crypto"
import { Session as InspectorSession } from "node:inspector"
import { createWriteStream } from "node:fs"
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { Memory } from "@opencode/schema/memory"
import { processRows } from "./execution-memory"

const DEFAULT_RETENTION = 60 * 60 * 1_000
const MAX_RETENTION = 24 * 60 * 60 * 1_000
const DEFAULT_DURATION = 10_000

class CaptureCancelled extends Error {}

type MutableCapture = {
  -readonly [Key in keyof Memory.Capture]: Memory.Capture[Key]
}

function wait(duration: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, duration)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    signal.addEventListener("abort", done, { once: true })
  })
}

function inspectorCommand(session: InspectorSession, method: "Profiler.enable" | "Profiler.start") {
  return new Promise<void>((resolve, reject) => {
    session.post(method, (error) => (error ? reject(error) : resolve()))
  })
}

function stopProfile(session: InspectorSession) {
  return new Promise<object>((resolve, reject) => {
    session.post("Profiler.stop", (error, result) => (error ? reject(error) : resolve(result.profile)))
  })
}

async function heapSnapshot(file: string, signal: AbortSignal) {
  const session = new InspectorSession()
  const output = createWriteStream(file, { mode: 0o600 })
  session.connect()
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", cancel)
      session.disconnect()
      if (error) {
        output.destroy()
        reject(error)
        return
      }
      output.end(resolve)
    }
    const cancel = () => finish(new CaptureCancelled())
    signal.addEventListener("abort", cancel, { once: true })
    session.on("HeapProfiler.addHeapSnapshotChunk", (message) => {
      if (!settled) output.write(message.params.chunk)
    })
    session.post("HeapProfiler.enable", (enableError) => {
      if (enableError) return finish(enableError)
      if (signal.aborted) return cancel()
      session.post("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: true }, (error) =>
        finish(error ?? undefined),
      )
    })
  })
}

async function cpuProfile(file: string, duration: number, signal: AbortSignal) {
  const session = new InspectorSession()
  session.connect()
  try {
    await inspectorCommand(session, "Profiler.enable")
    await inspectorCommand(session, "Profiler.start")
    await wait(duration, signal)
    const profile = await stopProfile(session)
    if (signal.aborted) throw new CaptureCancelled()
    await writeFile(file, JSON.stringify(profile), { mode: 0o600 })
  } finally {
    session.disconnect()
  }
}

async function processSamples(file: string, target: Memory.CaptureTarget, duration: number, signal: AbortSignal) {
  const startedAt = Date.now()
  const samples: Array<{ at: number; residentBytes: number | null; process?: NodeJS.MemoryUsage }> = []
  while (!signal.aborted && Date.now() - startedAt < duration) {
    if (target.kind === "server") {
      samples.push({ at: Date.now(), residentBytes: process.memoryUsage.rss(), process: process.memoryUsage() })
    } else {
      const row = (await processRows())?.find((item) => item.pid === target.pid)
      samples.push({ at: Date.now(), residentBytes: row?.bytes ?? null })
    }
    await wait(Math.min(1_000, Math.max(0, duration - (Date.now() - startedAt))), signal)
  }
  if (signal.aborted) throw new CaptureCancelled()
  await writeFile(
    file,
    JSON.stringify(
      {
        format: "redcode.process-samples.v1",
        target,
        runtime: `bun ${Bun.version}`,
        platform: `${process.platform} ${process.arch}`,
        startedAt,
        completedAt: Date.now(),
        samples,
        logs: [],
        logPolicy: "General logs are omitted because they may contain project or credential data.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
}

export async function createMemoryCaptures(root: string) {
  const directory = path.join(root, "diagnostics", "memory")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const captures = new Map<Memory.CaptureID, MutableCapture>()
  const running = new Map<Memory.CaptureID, AbortController>()
  let closed = false

  const manifest = (id: Memory.CaptureID) => path.join(directory, `${id}.meta.json`)
  const artifact = (capture: Memory.Capture) => {
    if (capture.filename === undefined) return undefined
    if (path.basename(capture.filename) !== capture.filename || !capture.filename.startsWith(`${capture.id}.`))
      return undefined
    return path.join(directory, capture.filename)
  }
  const save = async (capture: MutableCapture) => {
    if (closed) return
    const target = manifest(capture.id)
    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(capture), { mode: 0o600 })
    await rename(temporary, target)
  }
  const remove = async (capture: Memory.Capture) => {
    await Promise.all([
      rm(manifest(capture.id), { force: true }),
      ...(artifact(capture) ? [rm(artifact(capture)!, { force: true })] : []),
    ])
    captures.delete(capture.id)
  }
  const prune = async (now = Date.now()) => {
    await Promise.all(
      [...captures.values()].flatMap((capture) =>
        capture.expiresAt <= now && !running.has(capture.id) ? [remove(capture)] : [],
      ),
    )
  }

  for (const name of await readdir(directory)) {
    if (!name.endsWith(".meta.json")) continue
    const value = await readFile(path.join(directory, name), "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => undefined)
    const decoded = Schema.decodeUnknownOption(Memory.Capture)(value)
    if (decoded._tag === "None") continue
    const capture = { ...decoded.value } as MutableCapture
    if (capture.filename !== undefined && artifact(capture) === undefined) {
      capture.state = "failed"
      capture.completedAt = Date.now()
      capture.filename = undefined
      capture.size = undefined
      capture.error = "The stored diagnostic artifact reference is invalid."
      await save(capture)
    }
    if (capture.state === "pending" || capture.state === "running") {
      capture.state = "failed"
      capture.completedAt = Date.now()
      capture.error = "The server restarted before this capture completed."
      await save(capture)
    }
    captures.set(capture.id, capture)
  }
  await prune()
  const timer = setInterval(() => void prune(), 60_000)
  timer.unref?.()

  const run = async (capture: MutableCapture, input: Memory.CaptureStart, controller: AbortController) => {
    capture.state = "running"
    capture.startedAt = Date.now()
    await save(capture)
    const extension = input.kind === "heap" ? "heapsnapshot" : input.kind === "cpu" ? "cpuprofile" : "json"
    const filename = `${capture.id}.${extension}`
    const file = path.join(directory, filename)
    try {
      if (input.kind === "heap") {
        if (input.target.kind !== "server") throw new Error("Heap snapshots are available only for the Redcode runtime")
        if (controller.signal.aborted) throw new CaptureCancelled()
        await heapSnapshot(file, controller.signal)
      } else if (input.kind === "cpu") {
        if (input.target.kind !== "server") throw new Error("CPU profiles are available only for the Redcode runtime")
        await cpuProfile(file, input.durationMs ?? DEFAULT_DURATION, controller.signal)
      } else {
        await processSamples(file, input.target, input.durationMs ?? DEFAULT_DURATION, controller.signal)
      }
      const info = await stat(file)
      capture.state = "completed"
      capture.completedAt = Date.now()
      capture.filename = filename
      capture.size = info.size
    } catch (error) {
      await rm(file, { force: true })
      capture.state = error instanceof CaptureCancelled || controller.signal.aborted ? "cancelled" : "failed"
      capture.completedAt = Date.now()
      if (capture.state === "failed")
        capture.error = error instanceof Error ? error.message.slice(0, 2_048) : String(error)
    } finally {
      running.delete(capture.id)
      await save(capture)
    }
  }

  return {
    async list() {
      await prune()
      return [...captures.values()].sort((left, right) => right.createdAt - left.createdAt)
    },
    async start(input: Memory.CaptureStart) {
      if (closed) throw new Error("Diagnostic capture service is closed")
      if (input.target.kind === "process" && input.kind !== "samples")
        throw new Error("External processes support samples only; heap and CPU captures require the Redcode runtime")
      const createdAt = Date.now()
      const retention = Math.min(input.retentionMs ?? DEFAULT_RETENTION, MAX_RETENTION)
      const capture: MutableCapture = {
        id: Memory.CaptureID.make(`cap_${randomUUID()}`),
        kind: input.kind,
        target: input.target,
        state: "pending",
        createdAt,
        expiresAt: createdAt + retention,
      }
      captures.set(capture.id, capture)
      await save(capture)
      const controller = new AbortController()
      running.set(capture.id, controller)
      void run(capture, input, controller)
      return capture
    },
    async cancel(id: Memory.CaptureID) {
      const capture = captures.get(id)
      if (!capture) throw new Error("Diagnostic capture was not found")
      running.get(id)?.abort()
      return capture
    },
    async delete(id: Memory.CaptureID) {
      const capture = captures.get(id)
      if (!capture) throw new Error("Diagnostic capture was not found")
      if (running.has(id)) throw new Error("Cancel this capture before deleting it")
      await remove(capture)
    },
    download(id: Memory.CaptureID) {
      const capture = captures.get(id)
      const file = capture && capture.state === "completed" ? artifact(capture) : undefined
      if (!capture || !file) throw new Error("Completed diagnostic capture was not found")
      return { capture, file }
    },
    close() {
      closed = true
      clearInterval(timer)
      running.forEach((controller) => controller.abort())
    },
  }
}

export type MemoryCaptures = Awaited<ReturnType<typeof createMemoryCaptures>>
