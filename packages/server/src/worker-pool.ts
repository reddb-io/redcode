export * as WorkerPool from "./worker-pool"

import { Schema } from "effect"
import { Worker } from "@opencode/schema/worker"
import {
  OpenCode,
  isInvalidRequestError,
  isUnauthorizedError,
  isConsoleForbiddenError,
  isAgentNotFoundError,
  isLocationNotFoundError,
  isProviderNotFoundError,
  isSessionNotFoundError,
  type OpenCodeClient,
} from "@opencode/client/promise"
import { FileDiff } from "@opencode/schema/file-diff"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Flock } from "@opencode/util/flock"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"

export const Config = Worker.Config
export type Config = Worker.Config
export const Task = Worker.Task
export type Task = Worker.Task
export const Manifest = Worker.Manifest
export type Manifest = Worker.Manifest
export const Report = Worker.Report
export type Report = Worker.Report
type Entry = Worker.Entry
type MutableReport = { fingerprint: string; tasks: Entry[] }
type BatchInput = {
  config: string
  manifest: string
  report: string
  environment?: Readonly<Record<string, string | undefined>>
  signal?: AbortSignal
}

export async function readConfig(file: string): Promise<Config> {
  const config = await read(file, Config, { workers: [] })
  const ids = config.workers.map((worker) => worker.id)
  if (new Set(ids).size !== ids.length) throw new Error("Worker IDs must be unique")
  const slots = config.workers.flatMap((worker) =>
    worker.directories.map((directory) => `${address(worker.url)}:${directory}`),
  )
  if (new Set(slots).size !== slots.length) throw new Error("Each server checkout may belong to only one worker slot")
  config.workers.forEach((worker) => address(worker.url))
  return config
}

export async function readManifest(file: string): Promise<Manifest> {
  const manifest = await read(file, Manifest)
  if (new Set(manifest.tasks.map((task) => task.id)).size !== manifest.tasks.length)
    throw new Error("Task IDs must be unique")
  return manifest
}

export async function add(file: string, worker: Worker.Registration) {
  address(worker.url)
  await Flock.withLock(
    path.resolve(file),
    async () => {
      if (await Bun.file(`${file}.batch.json`).exists())
        throw new Error("Resume the unfinished batch before changing its worker registry")
      const config = await readConfig(file)
      if (config.workers.some((item) => item.id === worker.id)) throw new Error(`Worker ${worker.id} already exists`)
      if (
        config.workers.some(
          (item) =>
            address(item.url) === address(worker.url) &&
            item.directories.some((dir) => worker.directories.includes(dir)),
        )
      )
        throw new Error("This server checkout is already registered")
      await write(file, { workers: [...config.workers, worker] })
    },
    { dir: `${file}.locks`, timeoutMs: 2_000 },
  )
}

export async function remove(file: string, id: string) {
  await Flock.withLock(
    path.resolve(file),
    async () => {
      if (await Bun.file(`${file}.batch.json`).exists())
        throw new Error("Resume the unfinished batch before changing its worker registry")
      const config = await readConfig(file)
      if (!config.workers.some((worker) => worker.id === id)) throw new Error(`Worker ${id} does not exist`)
      await write(file, { workers: config.workers.filter((worker) => worker.id !== id) })
    },
    { dir: `${file}.locks`, timeoutMs: 2_000 },
  )
}

export async function health(
  worker: Worker.Registration,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return client(worker, environment).server.system({ signal: AbortSignal.timeout(5_000) })
}

/** One local coordinator owns a batch. Workers own independent Sessions and databases. */
export async function run(
  input: BatchInput & {
    timeoutMs?: number
    pollMs?: number
    recoverTask?: string
    onUpdate?: (entry: Entry) => void
    authorize?: (worker: Worker.Registration, directory: string) => Promise<void>
  },
) {
  if (
    [input.config, input.manifest, `${input.config}.batch.json`].some(
      (file) => path.resolve(input.report) === path.resolve(file),
    )
  )
    throw new Error("Report must be separate from the worker config and task manifest")
  // Different batches using the same registry must not run in the same checkout simultaneously.
  await using _lease = await Flock.acquire(path.resolve(input.config), {
    dir: `${input.config}.locks`,
    signal: input.signal,
    timeoutMs: 2_000,
  })
  const { config, manifest, report } = await loadBatch(input, !input.recoverTask)
  const recovery = input.recoverTask ? report.tasks.find((entry) => entry.id === input.recoverTask) : undefined
  if (
    input.recoverTask &&
    (!recovery ||
      !["unknown", "dispatching"].includes(recovery.state) ||
      !recovery.sessionID ||
      !recovery.messageID ||
      !recovery.directory)
  )
    throw new Error("Recovery requires an unknown or dispatching task with its original placement and IDs")
  const recoveryWorker = recovery ? config.workers.find((worker) => worker.id === recovery.worker) : undefined
  if (
    recovery &&
    (!recoveryWorker ||
      address(recoveryWorker.url) !== recovery.url ||
      !recoveryWorker.directories.includes(recovery.directory!))
  )
    throw new Error("Recovery placement does not match the saved worker")
  const eligible = (worker: Worker.Registration, task: Task) =>
    (!task.worker || task.worker === worker.id) && (task.tags ?? []).every((tag) => worker.tags.includes(tag))
  manifest.tasks.forEach((task) => {
    if (!config.workers.some((worker) => eligible(worker, task)))
      throw new Error(`No eligible worker for task ${task.id}`)
  })
  // Missing credentials fail before any remote Session is created; they are never persisted in the registry/report.
  const clients = new Map(config.workers.map((worker) => [worker.id, client(worker, input.environment ?? process.env)]))
  await write(input.report, report)
  await write(`${input.config}.batch.json`, { report: path.resolve(input.report) })
  const healthy = await Promise.all(
    config.workers.map(async (worker) => ({
      worker,
      online: await clients
        .get(worker.id)!
        .server.info({ signal: AbortSignal.timeout(5_000) })
        .then(
          () => true,
          () => false,
        ),
    })),
  )
  const saved = { tail: Promise.resolve() }
  const update = async (entry: Entry) => {
    report.tasks[report.tasks.findIndex((item) => item.id === entry.id)] = entry
    // Parallel slots serialize atomic journal writes before advancing to the next side effect.
    saved.tail = saved.tail.then(() => write(input.report, report))
    await saved.tail
    input.onUpdate?.(entry)
  }
  const observe = async (entry: Entry, api: OpenCodeClient): Promise<Entry> => {
    const deadline = Date.now() + (input.timeoutMs ?? 300_000)
    while (!input.signal?.aborted) {
      const options = { signal: AbortSignal.any([AbortSignal.timeout(5_000), ...(input.signal ? [input.signal] : [])]) }
      const session = await api.session.get({ sessionID: entry.sessionID! }, options).catch(() => undefined)
      if (!session)
        return {
          ...entry,
          state: "unknown",
          detail: "Could not observe the assigned Session; it has not been resubmitted",
        }
      if (session.outcome) {
        const messages = await api.message
          .list({ sessionID: session.id, order: "desc", limit: 100 }, options)
          .catch(() => undefined)
        return {
          ...entry,
          state: session.outcome,
          detail: undefined,
          text: messages?.data
            .toReversed()
            .flatMap((message) =>
              message.type === "assistant"
                ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
                : [],
            )
            .join("\n"),
        }
      }
      const permissions = await api.permission.list({ sessionID: session.id }, options).catch(() => undefined)
      const forms = await api.session.form.list({ sessionID: session.id }, options).catch(() => undefined)
      if (permissions?.length || forms?.length)
        return {
          ...entry,
          state: "waiting",
          detail: "Open this worker Session to answer its permission or input request",
        }
      if (Date.now() >= deadline)
        return {
          ...entry,
          state: "running",
          detail: "Observation deadline reached; the worker retains this Session and checkout",
        }
      await new Promise<void>((resolve) => setTimeout(resolve, input.pollMs ?? 1_000))
    }
    return { ...entry, state: "unknown", detail: "Coordinator disconnected; remote work may still be running" }
  }
  const terminal = (entry: Entry) => ["succeeded", "failed", "interrupted"].includes(entry.state)
  if (recovery) {
    await input.authorize?.(recoveryWorker!, recovery.directory!)
    const api = clients.get(recoveryWorker!.id)!
    const task = manifest.tasks.find((task) => task.id === recovery.id)!
    await update({
      ...recovery,
      state: "dispatching",
      detail: "Explicit recovery uses the original worker and admission IDs",
    })
    const recovered = await (async (): Promise<Entry> => {
      const options = {
        signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(input.signal ? [input.signal] : [])]),
      }
      const existing = await api.session.get({ sessionID: recovery.sessionID! }, options).catch((error: unknown) => {
        if (isSessionNotFoundError(error)) return undefined
        throw error
      })
      if (existing?.outcome) return observe(recovery, api)
      if (!existing)
        await api.session.create(
          {
            id: recovery.sessionID,
            title: `Worker task: ${task.id}`,
            location: { directory: recovery.directory! },
            agent: task.agent,
            model: task.model,
          },
          options,
        )
      // First admission wins, including prompts already delivered. Never invent a new ID on recovery.
      await input.authorize?.(recoveryWorker!, recovery.directory!)
      await api.session.prompt(
        { sessionID: recovery.sessionID!, id: recovery.messageID, text: task.prompt, resume: false },
        options,
      )
      await input.authorize?.(recoveryWorker!, recovery.directory!)
      await api.session.wake({ sessionID: recovery.sessionID! }, options)
      return { ...recovery, state: "running", detail: undefined }
    })().catch(
      (): Entry => ({
        ...recovery,
        state: "unknown",
        detail: "Recovery was not confirmed; original placement and IDs remain reserved",
      }),
    )
    await update(recovered)
  }
  // Reconnect only to the original placement. Never replay an ambiguous admission or fail over its side effects.
  await Promise.all(
    report.tasks
      .filter((entry) => entry.sessionID && !terminal(entry))
      .map(async (entry) => {
        const api = clients.get(entry.worker!)
        if (api) await update(await observe(entry, api))
      }),
  )
  await Promise.all(
    healthy
      .filter((item) => item.online)
      .flatMap(({ worker }) =>
        worker.directories.map(async (directory) => {
          if (
            report.tasks.some(
              (entry) => entry.worker === worker.id && entry.directory === directory && !terminal(entry),
            )
          )
            return
          while (!input.signal?.aborted) {
            // Check before selecting a queued entry: yielding after selection lets two slots claim the same task.
            const allowed = input.authorize
              ? await input.authorize(worker, directory).then(
                  () => true,
                  () => false,
                )
              : true
            const entry = report.tasks.find(
              (item) =>
                item.state === "queued" && eligible(worker, manifest.tasks.find((task) => task.id === item.id)!),
            )
            if (!entry) return
            if (!allowed) {
              await update({ ...entry, state: "failed", detail: "Access could not be verified before admission" })
              continue
            }
            const task = manifest.tasks.find((item) => item.id === entry.id)!
            const assigned: Entry = {
              id: entry.id,
              state: "dispatching",
              worker: worker.id,
              url: address(worker.url),
              directory,
              sessionID: Session.ID.create(),
              messageID: SessionMessage.ID.create(),
            }
            await update(assigned)
            const api = clients.get(worker.id)!
            const dispatched = await (async () => {
              const options = {
                signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(input.signal ? [input.signal] : [])]),
              }
              await api.session.create(
                {
                  id: assigned.sessionID,
                  title: `Worker task: ${task.id}`,
                  location: { directory },
                  agent: task.agent,
                  model: task.model,
                },
                options,
              )
              await input.authorize?.(worker, directory)
              await api.session.prompt(
                { sessionID: assigned.sessionID!, id: assigned.messageID, text: task.prompt },
                options,
              )
              await update({ ...assigned, state: "running" })
              return observe(assigned, api)
            })().catch((error: unknown): Entry => {
              if (
                isInvalidRequestError(error) ||
                isUnauthorizedError(error) ||
                isConsoleForbiddenError(error) ||
                isAgentNotFoundError(error) ||
                isLocationNotFoundError(error) ||
                isProviderNotFoundError(error)
              )
                return { ...assigned, state: "failed", detail: error.message }
              return {
                ...assigned,
                state: "unknown",
                detail:
                  "Remote admission or observation was not confirmed; inspect the assigned Session before retrying",
              }
            })
            await update(dispatched)
            if (!terminal(dispatched)) return
          }
        }),
      ),
  )
  if (report.tasks.every(terminal)) await rm(`${input.config}.batch.json`, { force: true })
  return report
}

/** Export the recorded task turn, not the checkout's potentially newer working changes. */
export async function collect(input: BatchInput & { task: string; output: string }) {
  await using _lease = await Flock.acquire(path.resolve(input.config), {
    dir: `${input.config}.locks`,
    signal: input.signal,
    timeoutMs: 2_000,
  })
  const { config, report } = await loadBatch(input, false)
  const entry = report.tasks.find((entry) => entry.id === input.task)
  if (!entry || !["succeeded", "failed", "interrupted"].includes(entry.state) || !entry.sessionID || !entry.messageID)
    throw new Error("Collect requires a terminal task with recorded Session and message IDs")
  const worker = config.workers.find((worker) => worker.id === entry.worker)
  if (!worker || address(worker.url) !== entry.url)
    throw new Error("Saved worker placement does not match the registry")
  const api = client(worker, input.environment ?? process.env)
  const options = { signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(input.signal ? [input.signal] : [])]) }
  const session = await api.session.get({ sessionID: entry.sessionID }, options)
  const active = await api.session.active(options)
  if (!session.outcome || active[entry.sessionID])
    throw new Error("The worker Session must be idle with a terminal outcome before collection")
  const diffs = Schema.decodeUnknownSync(Schema.Array(FileDiff.Info))(
    await api.session.diff({ sessionID: entry.sessionID, from: entry.messageID }, options),
  )
  const patch = diffs.map((diff) => diff.patch).join("\n")
  const artifact = {
    version: 1,
    task: entry.id,
    worker: worker.id,
    sessionID: entry.sessionID,
    messageID: entry.messageID,
    location: session.location,
    outcome: session.outcome,
    collectedAt: new Date().toISOString(),
    patchSha256: createHash("sha256").update(patch).digest("hex"),
    files: diffs,
    limitations: "Text patches only; binary contents, Git commits and checkout synchronization are not included.",
  }
  // Remote filenames remain data. Fixed output names cannot traverse paths or overwrite source files.
  const output = path.resolve(input.output)
  await mkdir(path.dirname(output), { recursive: true })
  await mkdir(output)
  await Bun.write(path.join(output, "result.json"), JSON.stringify(artifact, null, 2) + "\n", { mode: 0o600 })
  await Bun.write(path.join(output, "changes.patch"), patch, { mode: 0o600 })
  await Bun.write(path.join(output, "response.txt"), entry.text ?? "", { mode: 0o600 })
  return artifact
}

async function loadBatch(input: BatchInput, initialize: boolean) {
  const config = await readConfig(input.config)
  const manifest = await readManifest(input.manifest)
  const active = await read(
    `${input.config}.batch.json`,
    Schema.Struct({ report: Schema.String.check(Schema.isMinLength(1)) }),
    { report: path.resolve(input.report) },
  )
  if (active.report !== path.resolve(input.report))
    throw new Error(`An unfinished batch retains this pool: resume it using report ${active.report}`)
  if (
    (!initialize || (await Bun.file(`${input.config}.batch.json`).exists())) &&
    !(await Bun.file(input.report).exists())
  )
    throw new Error("The unfinished batch journal is missing; restore it before dispatching more work")
  const fingerprint = createHash("sha256").update(JSON.stringify({ config, manifest })).digest("hex")
  const loaded = await read(input.report, Report, {
    fingerprint,
    tasks: manifest.tasks.map((task) => ({ id: task.id, state: "queued" as const })),
  })
  const report: MutableReport = { fingerprint: loaded.fingerprint, tasks: [...loaded.tasks] }
  if (
    report.fingerprint !== fingerprint ||
    report.tasks.length !== manifest.tasks.length ||
    report.tasks.some((entry, index) => entry.id !== manifest.tasks[index]?.id)
  )
    throw new Error("The saved report belongs to a different batch or worker configuration; use a separate report")
  return { config, manifest, report }
}

export function address(value: string) {
  const url = new URL(value)
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Worker URL must be an HTTP(S) server origin without credentials, query or path")
  return url.origin
}

function client(worker: Worker.Registration, environment: Readonly<Record<string, string | undefined>>) {
  const password = environment[worker.passwordEnv]
  if (!password) throw new Error(`Set ${worker.passwordEnv} to this worker's server password or pairing token`)
  return OpenCode.make({
    baseUrl: address(worker.url),
    headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
  })
}

async function read<A>(file: string, schema: Schema.Decoder<A>, fallback?: A): Promise<A> {
  if (!(await Bun.file(file).exists()) && fallback) return fallback
  return Schema.decodeUnknownSync(schema)(await Bun.file(file).json())
}

async function write(file: string, value: unknown) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await Bun.write(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  await rename(temporary, file).catch(async (error: unknown) => {
    await rm(temporary, { force: true })
    throw error
  })
}
