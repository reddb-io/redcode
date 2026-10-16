export * as WorkerPool from "./worker-pool"

import { Schema } from "effect"
import { Worker } from "@opencode/schema/worker"
import { Attention } from "@opencode/schema/attention"
import { HostResources } from "@opencode/schema/host-resources"
import { WorkerEnvironment } from "@opencode/schema/worker-environment"
import { SessionObservation } from "@opencode/schema/session-observation"
import { WorkerLease } from "@opencode/schema/worker-lease"
import { AbsolutePath } from "@opencode/schema/schema"
import { resourceQueueReason } from "./worker-placement"
import {
  OpenCode,
  isInvalidRequestError,
  isUnauthorizedError,
  isConsoleForbiddenError,
  isAgentNotFoundError,
  isLocationNotFoundError,
  isProviderNotFoundError,
  isSessionNotFoundError,
  isMessageNotFoundError,
  type OpenCodeClient,
} from "@opencode/client/promise"
import { FileDiff } from "@opencode/schema/file-diff"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Flock } from "@opencode/util/flock"
import { sameDirectory } from "@opencode/util/path"
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
  /** A coordinator runtime incarnation, never restored from its task journal. */
  coordinator?: string
}
const localCoordinator = randomUUID()

export async function readConfig(file: string): Promise<Config> {
  const config = await read(file, Config, { workers: [] })
  const ids = config.workers.map((worker) => worker.id)
  if (new Set(ids).size !== ids.length) throw new Error("Worker IDs must be unique")
  const slots = config.workers.flatMap((worker) =>
    worker.directories.map((directory) =>
      JSON.stringify([address(worker.url), worker.environmentID ?? null, directory]),
    ),
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
            item.environmentID === worker.environmentID &&
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
  const { config, manifest, report, journalExists } = await loadBatch(input, !input.recoverTask)
  const coordinator = input.coordinator ?? localCoordinator
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
  if (report.tasks.every(terminal)) {
    await rm(`${input.config}.batch.json`, { force: true })
    return report
  }
  if (!journalExists) await write(input.report, report)
  if (!(await Bun.file(`${input.config}.batch.json`).exists()))
    await write(`${input.config}.batch.json`, { report: path.resolve(input.report) })
  const healthy = await Promise.all(
    config.workers.map(async (worker) => ({
      worker,
      ...(await clients
        .get(worker.id)!
        .server.info({ signal: AbortSignal.timeout(5_000) })
        .then(
          (info) => ({
            online: true,
            observation: info.capabilities?.sessionObservation === true,
            lease: info.capabilities?.workerLease === true,
          }),
          () => ({ online: false, observation: false, lease: false }),
        )),
    })),
  )
  const saved = { tail: Promise.resolve() }
  // Share a short-lived sample across slots registered against the same server origin.
  const samples = new Map<string, { startedAt: number; pending: Promise<HostResources.Snapshot | undefined> }>()
  const sample = (worker: Worker.Registration) => {
    const origin = address(worker.url)
    const cached = samples.get(origin)
    if (cached && Date.now() - cached.startedAt < 1_000) return cached.pending
    const pending = clients
      .get(worker.id)!
      .server.resources({
        signal: AbortSignal.any([AbortSignal.timeout(5_000), ...(input.signal ? [input.signal] : [])]),
      })
      .then(Schema.decodeUnknownSync(HostResources.Snapshot))
      .catch(() => undefined)
    samples.set(origin, { startedAt: Date.now(), pending })
    return pending
  }
  const reserved = (worker: Worker.Registration) =>
    report.tasks
      .filter((entry) => entry.url === address(worker.url) && entry.state !== "queued" && !terminal(entry))
      .reduce(
        (budget, entry) => {
          const resources = manifest.tasks.find((task) => task.id === entry.id)?.resources
          return {
            cpu: budget.cpu + (resources?.cpu ?? 0),
            memoryBytes: budget.memoryBytes + (resources?.memoryBytes ?? 0),
          }
        },
        { cpu: 0, memoryBytes: 0 },
      )
  const update = async (entry: Entry) => {
    const index = report.tasks.findIndex((item) => item.id === entry.id)
    if (JSON.stringify(report.tasks[index]) === JSON.stringify(entry)) return
    report.tasks[index] = entry
    // Parallel slots serialize atomic journal writes before advancing to the next side effect.
    saved.tail = saved.tail.then(() => write(input.report, report))
    await saved.tail
    input.onUpdate?.(entry)
  }
  const observation = async (
    entry: Entry,
    api: OpenCodeClient,
    options: { signal: AbortSignal },
  ): Promise<SessionObservation.Info> => {
    if (healthy.find((item) => item.worker.id === entry.worker)?.observation) {
      const status = Schema.decodeUnknownSync(SessionObservation.Info)(
        await api.session.observation({ sessionID: entry.sessionID!, messageID: entry.messageID! }, options),
      )
      if (status.sessionID !== entry.sessionID || status.messageID !== entry.messageID)
        throw new Error("Worker observation does not match the assigned admission")
      return status
    }
    // Older workers expose these separate reads. Inbox first, message second:
    // delivery cannot disappear between them when it atomically moves the input.
    const inbox = await api.session.inbox.list({ sessionID: entry.sessionID! }, options)
    const pending = inbox.some((item) => item.id === entry.messageID && item.type === "user")
    const message = pending
      ? undefined
      : await api.session.message
          .get({ sessionID: entry.sessionID!, messageID: entry.messageID! }, options)
          .catch((error: unknown) => {
            if (isMessageNotFoundError(error)) return undefined
            throw error
          })
    const session = await api.session.get({ sessionID: entry.sessionID! }, options)
    const active = await api.session.active(options)
    const waiting = active[session.id]
      ? await Promise.all([
          api.permission.list({ sessionID: session.id }, options),
          api.session.form.list({ sessionID: session.id }, options),
        ]).then(([permissions, forms]) => permissions.length > 0 || forms.length > 0)
      : false
    return {
      sessionID: Session.ID.make(session.id),
      messageID: SessionMessage.ID.make(entry.messageID!),
      directory: AbsolutePath.make(session.location.directory),
      pending: inbox.length > 0,
      admission: pending
        ? "pending"
        : message?.id === entry.messageID && message?.type === "user"
          ? "delivered"
          : "missing",
      execution: active[session.id] ? "running" : "idle",
      outcome: session.outcome,
      waiting,
    }
  }
  const observe = async (entry: Entry, api: OpenCodeClient): Promise<Entry> => {
    if (entry.lease && !entry.leaseReleased && entry.lease.holder !== coordinator) {
      // Restart recovery transfers only control of the saved assignment. No prompt or wake is sent.
      const acquired = await api.workerLease
        .acquire(
          {
            directory: entry.directory!,
            owner: entry.leaseOwner ?? entry.lease.owner,
            holder: coordinator,
            sessionID: entry.sessionID!,
            messageID: entry.messageID!,
            recover: entry.lease,
          },
          { signal: AbortSignal.timeout(5_000) },
        )
        .catch(() => undefined)
      if (!acquired || acquired.state === "busy" || acquired.state === "held")
        return {
          ...entry,
          state: "unknown",
          recoveryReason: "lease-lost",
          detail: "The original coordinator fence could not be recovered; checkout retained",
        }
      entry = {
        ...entry,
        ...reservation(acquired.lease),
        leaseReleased: acquired.state === "released" ? true : undefined,
      }
      await update(entry)
    }
    const deadline = Date.now() + (input.timeoutMs ?? 300_000)
    while (!input.signal?.aborted) {
      if (entry.lease && !entry.leaseReleased && (entry.leaseRenewAt ?? 0) <= Date.now()) {
        const lease = await api.workerLease
          .renew({ ...entry.lease, holder: coordinator }, { signal: AbortSignal.timeout(5_000) })
          .catch(() => undefined)
        if (!lease)
          return {
            ...entry,
            state: "unknown",
            recoveryReason: "lease-lost",
            detail: "Worker lease could not be renewed; the original checkout remains reserved",
          }
        entry = { ...entry, ...reservation(lease) }
        await update(entry)
      }
      const options = { signal: AbortSignal.any([AbortSignal.timeout(5_000), ...(input.signal ? [input.signal] : [])]) }
      const status = await observation(entry, api, options).catch(() => undefined)
      if (!status)
        return {
          ...entry,
          state: "unknown",
          recoveryReason: "unreachable",
          detail: "Could not observe the assigned Session; it has not been resubmitted",
        }
      if (!entry.directory || !sameDirectory(status.directory, entry.directory))
        return {
          ...entry,
          state: "unknown",
          recoveryReason: "placement-changed",
          detail: "The assigned Session moved away from the original checkout; restore its placement before recovery",
        }
      if (status.admission === "missing")
        return {
          ...entry,
          state: "unknown",
          recoveryReason: "admission-missing",
          detail: "The original task admission was not found; placement and IDs remain reserved",
        }
      if (status.admission === "delivered" && status.outcome && status.execution === "idle" && !status.pending) {
        if (entry.lease && !entry.leaseReleased) {
          const released = await api.workerLease.release({ ...entry.lease, holder: coordinator }, options).then(
            () => true,
            () => false,
          )
          if (!released)
            return {
              ...entry,
              state: "unknown",
              recoveryReason: "lease-lost",
              detail: "Worker checkout release was not confirmed; its assignment is retained",
            }
        }
        const messages = await api.message
          .list({ sessionID: entry.sessionID!, order: "desc", limit: 100 }, options)
          .catch(() => undefined)
        return {
          ...entry,
          state: status.outcome,
          leaseReleased: entry.lease ? true : undefined,
          recoveryReason: undefined,
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
      if (status.waiting)
        return {
          ...entry,
          state: "waiting",
          recoveryReason: undefined,
          detail: "Open this worker Session to answer its permission or input request",
        }
      if (status.execution === "suspended")
        return {
          ...entry,
          state: "unknown",
          recoveryReason: "execution-suspended",
          detail: "The worker execution was interrupted; its Session and checkout remain reserved",
        }
      if (Date.now() >= deadline && status.execution !== "running")
        return {
          ...entry,
          state: "unknown",
          recoveryReason: "execution-idle",
          detail: "Admission is confirmed but execution is idle; recover on the original worker",
        }
      if (Date.now() >= deadline)
        return {
          ...entry,
          state: "running",
          recoveryReason: undefined,
          detail: "Observation deadline reached; the worker retains this Session and checkout",
        }
      await new Promise<void>((resolve) => setTimeout(resolve, input.pollMs ?? 1_000))
    }
    return {
      ...entry,
      state: "unknown",
      recoveryReason: "unreachable",
      detail: "Coordinator disconnected; remote work may still be running",
    }
  }
  if (recovery) {
    await input.authorize?.(recoveryWorker!, recovery.directory!)
    const api = clients.get(recoveryWorker!.id)!
    const task = manifest.tasks.find((task) => task.id === recovery.id)!
    await update({
      ...recovery,
      state: "dispatching",
      detail: "Explicit recovery uses the original worker and admission IDs",
    })
    let recovering: Entry = recovery
    const recovered = await (async (): Promise<Entry> => {
      const options = {
        signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(input.signal ? [input.signal] : [])]),
      }
      const existing = await api.session.get({ sessionID: recovering.sessionID! }, options).catch((error: unknown) => {
        if (isSessionNotFoundError(error)) return undefined
        throw error
      })
      if (existing && !sameDirectory(existing.location.directory, recovering.directory!))
        throw new Error("The assigned Session moved away from the original checkout")
      if (!healthy.find((item) => item.worker.id === recovering.worker)?.lease)
        throw new Error("Upgrade the worker to recover with checkout fencing")
      let acquired = await api.workerLease.acquire(
        {
          directory: recovering.directory!,
          owner: recovering.leaseOwner ?? recovering.sessionID!,
          holder: coordinator,
          sessionID: recovering.sessionID!,
          messageID: recovering.messageID!,
          recover: recovering.lease
            ? {
                owner: recovering.lease.owner,
                holder: recovering.lease.holder,
                generation: recovering.lease.generation,
              }
            : undefined,
        },
        options,
      )
      if (acquired.state === "busy") throw new Error("Worker lease recovery was not confirmed")
      recovering = {
        ...recovering,
        leaseOwner: acquired.lease.owner,
        ...reservation(acquired.lease),
        leaseReleased: acquired.state === "released" ? true : undefined,
      }
      await update({ ...recovering, state: "dispatching" })
      if (acquired.state === "released") return observe(recovering, api)
      if (acquired.lease.remainingMs > 0 && acquired.lease.holder !== coordinator)
        throw new Error("The previous coordinator still holds an unexpired lease")
      if (acquired.lease.remainingMs <= 0) {
        acquired = await api.workerLease.acquire(
          {
            directory: recovering.directory!,
            owner: recovering.leaseOwner!,
            sessionID: recovering.sessionID!,
            messageID: recovering.messageID!,
            holder: coordinator,
            recover: {
              owner: recovering.lease!.owner,
              holder: recovering.lease!.holder,
              generation: recovering.lease!.generation,
            },
          },
          options,
        )
        if (acquired.state !== "acquired" || acquired.lease.remainingMs <= 0)
          throw new Error("Worker lease recovery was not confirmed")
        recovering = { ...recovering, ...reservation(acquired.lease) }
        await update({ ...recovering, state: "dispatching" })
      }
      const fenced = { ...options, headers: fenceHeaders(recovering, coordinator) }
      if (existing?.outcome) {
        const status = await observation(recovering, api, options)
        if (status.admission === "delivered" && status.execution === "idle" && !status.pending)
          return observe(recovering, api)
      }
      if (!existing)
        await api.session.create(
          {
            id: recovering.sessionID,
            title: `Worker task: ${task.id}`,
            location: { directory: recovering.directory! },
            agent: task.agent,
            model: task.model,
          },
          fenced,
        )
      // First admission wins, including prompts already delivered. Never invent a new ID on recovering.
      await input.authorize?.(recoveryWorker!, recovering.directory!)
      await api.session.prompt(
        { sessionID: recovering.sessionID!, id: recovering.messageID, text: task.prompt, resume: false },
        fenced,
      )
      await input.authorize?.(recoveryWorker!, recovering.directory!)
      await api.session.wake({ sessionID: recovering.sessionID! }, fenced)
      return {
        ...recovering,
        state: "dispatching",
        detail: "Recovery admitted; waiting for execution confirmation",
        recoveryReason: undefined,
      }
    })().catch(
      (): Entry => ({
        ...recovering,
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
      .filter((item) => item.online && item.lease)
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
            const measurement =
              allowed && manifest.tasks.some((task) => task.resources && eligible(worker, task))
                ? await sample(worker)
                : undefined
            // Sampling and authority checks precede selection; the journal claim is synchronous up to its write.
            const entry = report.tasks.find((item) => {
              const task = manifest.tasks.find((task) => task.id === item.id)!
              return (
                item.state === "queued" &&
                eligible(worker, task) &&
                (!allowed || !task.resources || !resourceQueueReason(task.resources, measurement, reserved(worker)))
              )
            })
            if (!entry) return
            if (!allowed) {
              await update({ ...entry, state: "failed", detail: "Access could not be verified before admission" })
              continue
            }
            const task = manifest.tasks.find((item) => item.id === entry.id)!
            let assigned: Entry = {
              id: entry.id,
              state: "dispatching",
              worker: worker.id,
              url: address(worker.url),
              directory,
              sessionID: Session.ID.create(),
              messageID: SessionMessage.ID.create(),
              leaseOwner: randomUUID(),
            }
            await update(assigned)
            const api = clients.get(worker.id)!
            const dispatched = await (async () => {
              const options = {
                signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(input.signal ? [input.signal] : [])]),
              }
              const acquired = await api.workerLease.acquire(
                {
                  directory,
                  owner: assigned.leaseOwner!,
                  holder: coordinator,
                  sessionID: assigned.sessionID!,
                  messageID: assigned.messageID!,
                },
                options,
              )
              if (acquired.state === "busy")
                return { id: assigned.id, state: "queued", queueReason: "lease-busy" } satisfies Entry
              if (acquired.state !== "acquired")
                throw new Error("Worker returned a released assignment during new admission")
              assigned = { ...assigned, ...reservation(acquired.lease) }
              await update(assigned)
              const fenced = { ...options, headers: fenceHeaders(assigned, coordinator) }
              await api.session.create(
                {
                  id: assigned.sessionID,
                  title: `Worker task: ${task.id}`,
                  location: { directory },
                  agent: task.agent,
                  model: task.model,
                },
                fenced,
              )
              await input.authorize?.(worker, directory)
              await api.session.prompt(
                { sessionID: assigned.sessionID!, id: assigned.messageID, text: task.prompt },
                fenced,
              )
              await update({
                ...assigned,
                state: "dispatching",
                detail: "Task admitted; waiting for execution confirmation",
              })
              return observe(assigned, api)
            })().catch(async (error: unknown): Promise<Entry> => {
              if (
                isInvalidRequestError(error) ||
                isUnauthorizedError(error) ||
                isConsoleForbiddenError(error) ||
                isAgentNotFoundError(error) ||
                isLocationNotFoundError(error) ||
                isProviderNotFoundError(error)
              ) {
                const released =
                  !assigned.lease ||
                  (await api.workerLease
                    .release({ ...assigned.lease, holder: coordinator }, { signal: AbortSignal.timeout(5_000) })
                    .then(
                      () => true,
                      () => false,
                    ))
                if (released)
                  return {
                    ...assigned,
                    state: "failed",
                    leaseReleased: assigned.lease ? true : undefined,
                    detail: error.message,
                  }
              }
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
  for (const entry of report.tasks.filter((entry) => entry.state === "queued")) {
    const task = manifest.tasks.find((task) => task.id === entry.id)!
    const online = healthy.filter((item) => item.online && eligible(item.worker, task))
    const candidates = online.filter((item) => item.lease)
    const free = candidates.filter(({ worker }) =>
      worker.directories.some(
        (directory) =>
          !report.tasks.some(
            (item) =>
              item.url === address(worker.url) &&
              item.directory === directory &&
              !terminal(item) &&
              item.state !== "queued",
          ),
      ),
    )
    const reason: Worker.QueueReason = !online.length
      ? "offline"
      : !candidates.length
        ? "lease-unsupported"
        : entry.queueReason === "lease-busy"
          ? "lease-busy"
          : !free.length
            ? "checkout-busy"
            : task.resources
              ? ((
                  await Promise.all(
                    free.map(async ({ worker }) =>
                      resourceQueueReason(task.resources!, await sample(worker), reserved(worker)),
                    ),
                  )
                ).find((reason) => reason !== undefined) ?? "checkout-busy")
              : "checkout-busy"
    if (entry.queueReason !== reason) await update({ ...entry, queueReason: reason })
  }
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

/** Inspect only assigned Sessions, not every Session hosted by the worker. */
export async function attention(input: BatchInput): Promise<Worker.Inbox> {
  const report = await read(input.report, Worker.Report)
  const active = report.tasks.filter((entry) => entry.sessionID && !terminal(entry))
  const data: Worker.Pending[] = []
  const unavailable: string[] = []
  for (let offset = 0; offset < active.length; offset += 4) {
    const page = await Promise.all(
      active.slice(offset, offset + 4).map(async (entry) => {
        const result = await assignedSession(input, entry.id)
          .then(async (assigned) => {
            const [permissions, forms] = await Promise.all([
              assigned.api.permission.list({ sessionID: assigned.session.id }, assigned.options),
              assigned.api.session.form.list({ sessionID: assigned.session.id }, assigned.options),
            ])
            return {
              task: assigned.entry,
              attention: Schema.decodeUnknownSync(Attention.Entry)({
                session: assigned.session,
                permissions: permissions.filter((item) => item.sessionID === assigned.session.id),
                forms: forms.filter((item) => item.sessionID === assigned.session.id),
              }),
            } satisfies Worker.Pending
          })
          .catch(() => undefined)
        if (!result) unavailable.push(entry.id)
        return result
      }),
    )
    data.push(
      ...page
        .filter((entry) => entry !== undefined)
        .filter((entry) => entry.attention.permissions.length > 0 || entry.attention.forms.length > 0),
    )
  }
  return { data, unavailable }
}

/** Revalidate the assignment and the pending request immediately before answering it. */
export async function answer(input: BatchInput, answer: Worker.Answer) {
  const assigned = await assignedSession(input, answer.task)
  if (answer.kind === "permission") {
    const permissions = await assigned.api.permission.list({ sessionID: assigned.session.id }, assigned.options)
    if (!permissions.some((request) => request.sessionID === assigned.session.id && request.id === answer.requestID))
      throw new Error("The assigned Session is no longer waiting on this permission")
    await assigned.api.permission.reply(
      { sessionID: assigned.session.id, requestID: answer.requestID, decision: answer.decision },
      assigned.options,
    )
    return
  }
  const forms = await assigned.api.session.form.list({ sessionID: assigned.session.id }, assigned.options)
  const form = forms.find((form) => form.sessionID === assigned.session.id && form.id === answer.formID)
  if (!form || form.metadata?.kind !== "question")
    throw new Error("The assigned Session is no longer waiting on this question")
  if (answer.kind === "cancel") {
    await assigned.api.session.form.cancel({ sessionID: assigned.session.id, formID: form.id }, assigned.options)
    return
  }
  await assigned.api.session.form.reply(
    { sessionID: assigned.session.id, formID: form.id, answer: answer.answer },
    assigned.options,
  )
}

export async function resources(
  worker: Worker.Registration,
  environment: Readonly<Record<string, string | undefined>>,
) {
  return client(worker, environment).server.resources({ signal: AbortSignal.timeout(5_000) })
}

/** Reuse the native Session harness with first-admission-wins prompt IDs and original task placement. */
export async function control(input: BatchInput, control: Worker.Control) {
  if (control.kind === "cancel") {
    await using _lease = await Flock.acquire(path.resolve(input.config), {
      dir: `${input.config}.locks`,
      signal: input.signal,
      timeoutMs: 2_000,
    })
    const { report } = await loadBatch(input, false)
    const entry = report.tasks.find((entry) => entry.id === control.task)
    if (!entry || entry.state !== "queued" || entry.sessionID)
      throw new Error("Only an unassigned queued task can be cancelled")
    report.tasks[report.tasks.indexOf(entry)] = {
      ...entry,
      state: "interrupted",
      queueReason: undefined,
      detail: "Cancelled before assignment",
    }
    await write(input.report, report)
    if (report.tasks.every(terminal)) await rm(`${input.config}.batch.json`, { force: true })
    return
  }
  const assigned = await assignedSession(input, control.task)
  if (assigned.session.outcome) throw new Error("The assigned task has already completed")
  if (control.kind === "interrupt") {
    await assigned.api.session.interrupt({ sessionID: assigned.session.id }, assigned.options)
    return
  }
  await assigned.api.session.prompt(
    { sessionID: assigned.session.id, id: control.id, text: control.text, delivery: control.delivery },
    assigned.options,
  )
}

async function assignedSession(input: BatchInput, task: string) {
  const [config, report] = await Promise.all([readConfig(input.config), read(input.report, Worker.Report)])
  const entry = report.tasks.find((entry) => entry.id === task)
  if (!entry?.sessionID || !entry.directory || terminal(entry))
    throw new Error("This task has no live assigned Session")
  const worker = config.workers.find((worker) => worker.id === entry.worker)
  if (!worker || address(worker.url) !== entry.url || !worker.directories.includes(entry.directory))
    throw new Error("Saved worker placement does not match the registry")
  const api = client(worker, input.environment ?? process.env)
  const options = { signal: AbortSignal.any([AbortSignal.timeout(5_000), ...(input.signal ? [input.signal] : [])]) }
  const session = await api.session.get({ sessionID: entry.sessionID }, options)
  if (!sameDirectory(session.location.directory, entry.directory))
    throw new Error("The assigned Session moved away from the authorized checkout")
  if (!entry.lease || entry.leaseReleased)
    throw new Error("Recover the original worker lease before controlling this task")
  return {
    entry,
    session,
    api,
    options: { ...options, headers: fenceHeaders(entry, input.coordinator ?? localCoordinator) },
  }
}

function reservation(value: unknown) {
  const lease = Schema.decodeUnknownSync(WorkerLease.Info)(value)
  // Schedule from a worker-reported duration, never its absolute clock.
  return { lease, leaseRenewAt: Date.now() + Math.max(0, lease.remainingMs - 40_000) }
}

function fenceHeaders(entry: Entry, coordinator: string) {
  if (!entry.lease) throw new Error("The task has no confirmed worker lease")
  return {
    "x-redcode-worker-fence": JSON.stringify({
      owner: entry.lease.owner,
      holder: coordinator,
      generation: entry.lease.generation,
    }),
  }
}

function terminal(entry: Entry) {
  return ["succeeded", "failed", "interrupted"].includes(entry.state)
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
  const journalExists = await Bun.file(input.report).exists()
  if ((!initialize || (await Bun.file(`${input.config}.batch.json`).exists())) && !journalExists)
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
  return { config, manifest, report, journalExists }
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
    ...(worker.environmentID && worker.environmentProxy
      ? {
          fetch: Object.assign(
            async (input: RequestInfo | URL, init?: RequestInit) => {
              const request = new Request(input, init)
              const url = new URL(request.url)
              const response = await fetch(
                `${address(worker.url)}/api/worker-environments/${encodeURIComponent(worker.environmentID!)}/request`,
                {
                  method: "POST",
                  headers: {
                    authorization: `Basic ${btoa(`opencode:${password}`)}`,
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    method: request.method,
                    path: url.pathname + url.search,
                    ...(request.headers.has("x-redcode-worker-fence")
                      ? { fence: JSON.parse(request.headers.get("x-redcode-worker-fence")!) }
                      : {}),
                    ...(!["GET", "HEAD"].includes(request.method) ? { body: await request.text() } : {}),
                  }),
                  signal: request.signal,
                },
              )
              if (!response.ok) return response
              const result = Schema.decodeUnknownSync(WorkerEnvironment.Response)(await response.json())
              return new Response(result.status === 204 ? null : result.body, {
                status: result.status,
                headers: { "content-type": result.contentType },
              })
            },
            { preconnect: fetch.preconnect },
          ),
        }
      : {}),
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
