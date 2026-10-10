export * as Workers from "./workers"

import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/schema/integration"
import { Worker } from "@opencode/schema/worker"
import { Global } from "@opencode/util/global"
import { Flock } from "@opencode/util/flock"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { mkdir, readdir, rename, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { WorkerPool } from "./worker-pool"
import { InfrastructureAccess } from "./infrastructure-access"
import { ServerAccess } from "@opencode/protocol/server-access"
import { ConsoleForbiddenError } from "@opencode/protocol/console"
import { optional } from "@opencode/schema/schema"

export interface Interface {
  readonly list: (scope?: ServerAccess.Principal) => Promise<Worker.Snapshot>
  readonly add: (input: Worker.Register, scope?: ServerAccess.Principal) => Promise<Worker.Status>
  readonly remove: (id: string, scope?: ServerAccess.Principal) => Promise<void>
  readonly probe: (id: string, scope?: ServerAccess.Principal) => Promise<Worker.Status>
  readonly submit: (manifest: Worker.Manifest, scope?: ServerAccess.Principal) => Promise<Worker.Batch>
  readonly recover: (id: string, task: string, scope?: ServerAccess.Principal) => Promise<Worker.Batch>
  readonly collect: (id: string, task: string, scope?: ServerAccess.Principal) => Promise<Worker.Artifact>
}
export class Service extends Context.Service<Service, Interface>()("@opencode/Workers") {}

const Metadata = Schema.Struct({
  id: Worker.Name,
  createdAt: Schema.String,
  manifest: Worker.Manifest,
  accountID: optional(Schema.String),
  workspaceID: optional(Schema.String),
  ownerID: optional(Schema.String),
  credentialID: optional(Schema.String),
})
const terminal = (report?: Worker.Report) =>
  Boolean(report?.tasks.every((task) => ["succeeded", "failed", "interrupted"].includes(task.state)))
const directoryKey = (directory: string) =>
  /^[a-zA-Z]:[\\/]/.test(directory)
    ? path.win32
        .normalize(directory)
        .toLowerCase()
        .replace(/[\\/]$/, "")
    : path.posix.normalize(directory).replace(/\/$/, "") || "/"

function layer(directory?: string, accessOptions?: InfrastructureAccess.Options) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const global = yield* Global.Service
      const credential = yield* Credential.Service
      const infrastructure = yield* Effect.provide(
        InfrastructureAccess.Service,
        InfrastructureAccess.layer(accessOptions),
      )
      const verify = async (token: string, resourceID: string, workspaceID?: string) => {
        const result = await Effect.runPromise(
          infrastructure.verify(token, resourceID, workspaceID).pipe(Effect.result),
        )
        if (result._tag === "Failure") throw result.failure
        return result.success
      }
      const denied = () => new ConsoleForbiddenError({ message: "Infrastructure access denied" })
      const manage = (scope?: ServerAccess.Principal) => {
        if (scope && scope.access.ownerRole !== "admin") throw denied()
      }
      const root = path.resolve(directory ?? path.join(global.state, "workers"))
      const config = path.join(root, "workers.json")
      const batches = path.join(root, "batches")
      const abort = new AbortController()
      const state = { busy: false, error: undefined as string | undefined }
      const connections = new Map<string, Worker.Status>()
      const failures = new Map<string, string>()
      const name = (id: string) => Schema.decodeUnknownSync(Worker.Name)(id)
      const folder = (id: string) => path.join(batches, name(id))
      const io = <A>(run: () => Promise<A>) =>
        Effect.tryPromise({ try: run, catch: (error) => new Error(String(error)) })
      const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)
      const environment = async (file = config) => {
        const registry = await WorkerPool.readConfig(file)
        const secrets = await Promise.all(
          registry.workers.map(async (worker) => {
            const stored = await run(credential.get(Credential.ID.make(worker.passwordEnv)))
            return [
              worker.passwordEnv,
              stored?.integrationID === `redcode-worker:${worker.id}` && stored.value.type === "key"
                ? stored.value.key
                : undefined,
            ] as const
          }),
        )
        return Object.fromEntries(secrets)
      }
      const batch = async (id: string): Promise<Worker.Batch> => {
        const metadata = Schema.decodeUnknownSync(Metadata)(await Bun.file(path.join(folder(id), "batch.json")).json())
        const reportFile = Bun.file(path.join(folder(id), "report.json"))
        const report = (await reportFile.exists())
          ? Schema.decodeUnknownSync(Worker.Report)(await reportFile.json())
          : undefined
        return {
          id: metadata.id,
          createdAt: metadata.createdAt,
          manifest: metadata.manifest,
          ...(metadata.accountID ? { accountID: metadata.accountID } : {}),
          ...(metadata.workspaceID ? { workspaceID: metadata.workspaceID } : {}),
          ...(report ? { report } : {}),
          observing: state.busy && !terminal(report),
          ...(failures.has(id) ? { error: failures.get(id) } : {}),
        }
      }
      const all = async () => {
        const entries = await readdir(batches, { withFileTypes: true })
        const committed = await Promise.all(
          entries
            .filter((entry) => entry.isDirectory() && Schema.is(Worker.Name)(entry.name))
            .map(async (entry) =>
              (await Bun.file(path.join(folder(entry.name), "batch.json")).exists()) ? entry.name : undefined,
            ),
        )
        return Promise.all(committed.filter((id) => id !== undefined).map((id) => batch(id)))
      }
      const ready = () => {
        if (state.error) throw new Error(state.error)
        abort.signal.throwIfAborted()
      }
      const input = async (id: string) => ({
        config: path.join(folder(id), "registry.json"),
        manifest: path.join(folder(id), "manifest.json"),
        report: path.join(folder(id), "report.json"),
        environment: await environment(path.join(folder(id), "registry.json")),
        signal: abort.signal,
        authorize: async (worker: Worker.Registration, directory: string) => {
          const metadata = Schema.decodeUnknownSync(Metadata)(
            await Bun.file(path.join(folder(id), "batch.json")).json(),
          )
          if (!metadata.credentialID) return
          const saved = await run(credential.get(Credential.ID.make(metadata.credentialID)))
          if (!saved || saved.value.type !== "key" || !worker.resourceID) throw denied()
          const access = await verify(saved.value.key, worker.resourceID, metadata.workspaceID)
          if (
            access.accountID !== metadata.accountID ||
            (!metadata.workspaceID && access.ownerID !== metadata.ownerID) ||
            (!access.ownerRole && !access.directories.includes(directoryKey(directory)))
          )
            throw denied()
        },
      })
      const permitted = async (worker: Worker.Registration, scope?: ServerAccess.Principal) => {
        if (!scope) return worker
        if (!worker.resourceID) return undefined
        const access = await verify(scope.token, worker.resourceID, scope.access.workspaceID).catch(() => undefined)
        if (!access || (!scope.access.workspaceID && access.ownerID !== scope.access.ownerID)) return undefined
        const directories = access.ownerRole
          ? worker.directories
          : worker.directories.filter((directory) => access.directories.includes(directoryKey(directory)))
        return directories.length ? { ...worker, directories } : undefined
      }
      const visible = (item: Worker.Batch, scope?: ServerAccess.Principal) =>
        !scope ||
        scope.access.ownerRole === "admin" ||
        (item.accountID === scope.access.accountID && item.workspaceID === scope.access.workspaceID) ||
        (!!scope.access.workspaceID &&
          item.workspaceID === scope.access.workspaceID &&
          ["owner", "admin"].includes(scope.access.organizationRole ?? ""))
      const authorizedBatch = async (id: string, scope?: ServerAccess.Principal) => {
        const item = await batch(id)
        if (!visible(item, scope)) throw denied()
        if (scope) {
          const registry = await WorkerPool.readConfig(path.join(folder(id), "registry.json"))
          if (
            !(
              await Promise.all(
                registry.workers.map(async (worker) => {
                  const allowed = await permitted(worker, scope)
                  return !!allowed && allowed.directories.length === worker.directories.length
                }),
              )
            ).every(Boolean)
          )
            throw denied()
        }
        return item
      }
      const pump = async () => {
        if (state.error || state.busy || abort.signal.aborted) return
        state.busy = true
        try {
          const pending = (await all())
            .filter((item) => !terminal(item.report))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          for (const item of pending) {
            await WorkerPool.run({ ...(await input(item.id)), timeoutMs: 500, pollMs: 100 }).then(
              () => failures.delete(item.id),
              () => failures.set(item.id, "Could not observe this batch. Check worker connections and credentials."),
            )
            // One durable batch reserves the registry until all of its tasks are terminal.
            if (!terminal((await batch(item.id)).report)) break
            const metadata = Schema.decodeUnknownSync(Metadata)(
              await Bun.file(path.join(folder(item.id), "batch.json")).json(),
            )
            if (metadata.credentialID) await run(credential.remove(Credential.ID.make(metadata.credentialID)))
          }
        } finally {
          state.busy = false
        }
      }
      if (typeof Bun === "undefined") state.error = "Worker coordination requires a Bun host"
      if (!state.error) {
        yield* io(() => mkdir(batches, { recursive: true, mode: 0o700 }))
        const lease = yield* io(() => Flock.acquire(root, { dir: path.join(root, "owner"), timeoutMs: 100 })).pipe(
          Effect.option,
        )
        if (lease._tag === "None") state.error = "Another server owns this worker coordinator"
        if (lease._tag === "Some") yield* Effect.addFinalizer(() => io(() => lease.value.release()).pipe(Effect.ignore))
        yield* io(pump).pipe(
          Effect.uninterruptible,
          Effect.catch(() => Effect.void),
          Effect.delay("1 second"),
          Effect.forever,
          Effect.forkScoped,
        )
        // Abort dispatch before joining the pump, then release ownership after its journal writes finish.
        yield* Effect.addFinalizer(() => Effect.sync(() => abort.abort()))
      }
      const mutate = <A>(operation: () => Promise<A>) => {
        ready()
        return Flock.withLock("workers-api", operation, {
          dir: path.join(root, "mutations"),
          signal: abort.signal,
          timeoutMs: 2_000,
        })
      }
      return Service.of({
        list: async (scope) => {
          if (state.error) return { available: false, reason: state.error, workers: [], batches: [] }
          const registry = await WorkerPool.readConfig(config)
          const workers = (await Promise.all(registry.workers.map((worker) => permitted(worker, scope)))).filter(
            (worker) => worker !== undefined,
          )
          return {
            available: true,
            workers: workers.map((worker) => ({
              ...(connections.get(worker.id) ?? { connection: "unchecked" as const }),
              worker,
            })),
            batches: (
              await Promise.all(
                (await all())
                  .filter((item) => visible(item, scope))
                  .map(async (item) => await authorizedBatch(item.id, scope).catch(() => undefined)),
              )
            )
              .filter((item) => item !== undefined)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          }
        },
        add: (value, scope) =>
          mutate(async () => {
            manage(scope)
            if (scope) {
              if (!value.resourceID) throw denied()
              const access = await verify(scope.token, value.resourceID)
              if (access.ownerRole !== "admin" || access.ownerID !== scope.access.ownerID) throw denied()
            }
            if ((await all()).some((item) => !terminal(item.report)))
              throw new Error("Finish the current batch before changing workers")
            const stored = await run(
              credential.create({
                integrationID: Integration.ID.make(`redcode-worker:${value.id}`),
                value: { type: "key", key: value.password },
                activate: false,
              }),
            )
            const worker = {
              id: value.id,
              url: value.url,
              directories: value.directories,
              ...(value.resourceID ? { resourceID: value.resourceID } : {}),
              tags: value.tags,
              passwordEnv: stored.id,
            }
            const health = await WorkerPool.health(worker, { [stored.id]: value.password }).catch(async () => {
              await run(credential.remove(stored.id))
              throw new Error("Could not authenticate this worker. Check its address and password.")
            })
            await WorkerPool.add(config, worker).catch(async (error: unknown) => {
              await run(credential.remove(stored.id))
              throw error
            })
            const status: Worker.Status = { worker, connection: "online", platform: health.platform }
            connections.set(worker.id, status)
            return status
          }),
        remove: (id, scope) =>
          mutate(async () => {
            manage(scope)
            if ((await all()).some((item) => !terminal(item.report)))
              throw new Error("Finish the current batch before changing workers")
            const worker = (await WorkerPool.readConfig(config)).workers.find((entry) => entry.id === id)
            await WorkerPool.remove(config, id)
            if (worker) await run(credential.remove(Credential.ID.make(worker.passwordEnv)))
            connections.delete(id)
          }),
        probe: async (id, scope) => {
          ready()
          const worker = (await WorkerPool.readConfig(config)).workers.find((entry) => entry.id === id)
          if (!worker) throw new Error("Worker does not exist")
          const authorized = await permitted(worker, scope)
          if (!authorized) throw denied()
          const health = await WorkerPool.health(worker, await environment()).catch(() => undefined)
          const status: Worker.Status = {
            worker: authorized,
            connection: health ? "online" : "offline",
            ...(health ? { platform: health.platform } : {}),
          }
          connections.set(id, status)
          return status
        },
        submit: (manifest, scope) =>
          mutate(async () => {
            if (state.busy || (await all()).some((item) => !terminal(item.report)))
              throw new Error("Finish the current batch before submitting another")
            const original = await WorkerPool.readConfig(config)
            const registry = {
              workers: (await Promise.all(original.workers.map((worker) => permitted(worker, scope)))).filter(
                (worker) => worker !== undefined,
              ),
            }
            if (new Set(manifest.tasks.map((task) => task.id)).size !== manifest.tasks.length)
              throw new Error("Task IDs must be unique")
            const secrets = await environment()
            for (const task of manifest.tasks) {
              if (
                !registry.workers.some(
                  (worker) =>
                    (!task.worker || task.worker === worker.id) &&
                    (task.tags ?? []).every((tag) => worker.tags.includes(tag)) &&
                    secrets[worker.passwordEnv],
                )
              )
                throw new Error(`No authenticated eligible worker for task ${task.id}`)
            }
            const id = `batch-${randomUUID()}`
            const credentialID = scope ? Credential.ID.make(`redcode-batch:${id}`) : undefined
            if (scope && credentialID)
              await run(
                credential.create({
                  id: credentialID,
                  integrationID: Integration.ID.make("redcode-batch"),
                  value: { type: "key", key: scope.token },
                  activate: false,
                }),
              )
            await mkdir(folder(id), { mode: 0o700 })
            await write(path.join(folder(id), "registry.json"), registry)
            await write(path.join(folder(id), "manifest.json"), manifest)
            await write(path.join(folder(id), "batch.json"), {
              id,
              createdAt: new Date().toISOString(),
              manifest,
              ...(scope
                ? {
                    accountID: scope.access.accountID,
                    ownerID: scope.access.ownerID,
                    workspaceID: scope.access.workspaceID,
                    credentialID,
                  }
                : {}),
            })
            return batch(id)
          }),
        recover: (id, task, scope) =>
          mutate(async () => {
            await authorizedBatch(id, scope)
            if (state.busy) throw new Error("The coordinator is observing this batch; try again shortly")
            state.busy = true
            try {
              await WorkerPool.run({ ...(await input(id)), recoverTask: name(task), timeoutMs: 500, pollMs: 100 })
              failures.delete(id)
            } finally {
              state.busy = false
            }
            return batch(id)
          }),
        collect: async (id, task, scope) => {
          ready()
          await authorizedBatch(id, scope)
          const savedPath = path.join(folder(id), `artifact-${name(task)}.json`)
          const saved = Bun.file(savedPath)
          if (await saved.exists()) return Schema.decodeUnknownSync(Worker.Artifact)(await saved.json())
          const original = await batch(id)
          const output = path.join(folder(id), `collected-${randomUUID()}`)
          const registry = path.join(folder(id), "registry.json")
          const collected = await WorkerPool.collect({
            ...(await input(id)),
            config: registry,
            environment: await environment(registry),
            task: name(task),
            output,
          })
          const artifact = {
            task: original.report!.tasks.find((entry) => entry.id === task)!,
            files: collected.files,
            patch: await Bun.file(path.join(output, "changes.patch")).text(),
            patchSha256: collected.patchSha256,
            collectedAt: collected.collectedAt,
          }
          await write(savedPath, artifact)
          return artifact
        },
      })
    }),
  )
}

export const configured = (directory?: string, access?: InfrastructureAccess.Options) =>
  makeGlobalNode({ service: Service, layer: layer(directory, access), deps: [Global.node, Credential.node] })
export const node = configured()

async function write(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`
  await Bun.write(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(temporary, file).catch(async (error: unknown) => {
    await rm(temporary, { force: true })
    throw error
  })
}
