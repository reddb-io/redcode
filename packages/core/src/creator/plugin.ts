export * as CreatorPlugins from "./plugin.js"

import { CreatorPlugin } from "@opencode/schema/creator-plugin"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { mkdir, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Host } from "@opencode/plugin/host"
import { DesignStore } from "../design/store.js"
import { DesignFiles } from "../design/files.js"
import { Plugin } from "../plugin.js"
import { PluginSupervisor } from "../plugin/supervisor.js"
import { CreatorPluginSource } from "./plugin-source.js"
import { CreatorPluginProbe } from "./plugin-probe.js"

export class Error extends Schema.TaggedError<Error>()("CreatorPlugin.Error", {
  code: Schema.Literals(["not-found", "conflict", "invalid", "unavailable"]),
  message: Schema.String,
}) {}
const Manifest = Schema.Struct({
  name: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

const make = Effect.gen(function* () {
  const designs = yield* DesignStore.Service
  const source = yield* CreatorPluginSource.Service
  const runtime = yield* Plugin.Service
  const probe = yield* CreatorPluginProbe.Service
  const supervisor = yield* PluginSupervisor.Service
  const lock = yield* Semaphore.make(1)
  const read = Effect.fn("CreatorPlugins.read")(function* (id: CreatorPlugin.ID, version?: number) {
    const item = (yield* source.list()).find((item) => item.id === id)
    if (!item) return yield* new Error({ code: "not-found", message: "Creator plugin not found in this project" })
    if (version !== undefined && item.version !== version)
      return yield* new Error({ code: "conflict", message: "This installation changed. Refresh before trying again." })
    return item
  })
  const matches = (item: CreatorPlugin.Info, plugin: Plugin.Info) =>
    plugin.source.type === "local" &&
    (plugin.source.path === source.directory(item.id) ||
      plugin.source.path.startsWith(source.directory(item.id) + path.sep))
  const list = Effect.fn("CreatorPlugins.list")(function* () {
    const plugins = yield* runtime.list()
    return (yield* source.list()).map((item) => {
      const loaded = plugins.find((plugin) => matches(item, plugin))
      return {
        ...item,
        runtime: loaded?.state.status ?? (item.enabled ? (supervisor.pending() ? "pending" : "failed") : "disabled"),
        ...(loaded?.state.status === "failed"
          ? { error: loaded.state.error }
          : item.enabled && !loaded && !supervisor.pending()
            ? {
                error:
                  "The plugin was not activated. Check project plugin selectors and organization integration policies.",
              }
            : {}),
      } satisfies typeof CreatorPlugin.Entry.Type
    })
  })
  const candidates = Effect.fn("CreatorPlugins.candidates")(function* () {
    return yield* Effect.forEach(yield* designs.projectDocuments(), (document) =>
      Effect.gen(function* () {
        if (!document.revision) return []
        const revision = yield* designs.revision(document.sessionID, document.id, document.revision)
        const contract = revision.document.collaboration?.contracts.creator
        if (contract?.kind !== "extension" || contract.target !== "server-plugin") return []
        return [
          {
            sessionID: document.sessionID,
            designID: document.id,
            revision: revision.id,
            name: document.name,
            entry: contract.entry,
            capabilities: contract.capabilities,
          },
        ]
      }),
    ).pipe(Effect.map((items) => items.flat()))
  })
  const prepare = Effect.fn("CreatorPlugins.prepare")(function* (input: CreatorPlugin.Source) {
    const origin = (yield* designs.projectDocuments()).find(
      (item) => item.sessionID === input.sessionID && item.id === input.designID,
    )
    if (!origin)
      return yield* new Error({ code: "not-found", message: "Plugin source is not in this project location" })
    const revision = yield* designs.revision(input.sessionID, input.designID, input.revision)
    const contract = revision.document.collaboration?.contracts.creator
    if (contract?.kind !== "extension" || contract.target !== "server-plugin")
      return yield* new Error({
        code: "invalid",
        message: "Publish a Creator server-plugin delivery contract before installing it",
      })
    const manifestHash = revision.files["package.json"]
    if (!manifestHash)
      return yield* new Error({ code: "invalid", message: "The published package needs package.json at its root" })
    const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))(
      new TextDecoder().decode(yield* designs.readBlob(manifestHash)),
    ).pipe(
      Effect.mapError(
        () => new Error({ code: "invalid", message: "package.json must contain a package name and version" }),
      ),
    )
    const files = Object.keys(revision.files).filter((file) => !file.startsWith(".compiled/"))
    if (!files.includes(contract.entry))
      return yield* new Error({
        code: "invalid",
        message: `Declared entry is missing from the revision: ${contract.entry}`,
      })
    const sizes = yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        if (
          !file ||
          file.includes(":") ||
          file.includes("\\") ||
          path.posix.normalize(file) !== file ||
          file.startsWith("/") ||
          file.startsWith("../")
        )
          return yield* new Error({ code: "invalid", message: `Invalid package path: ${file}` })
        return (yield* designs.readBlob(revision.files[file]!)).length
      }),
    )
    return {
      review: {
        ...input,
        name: revision.document.name,
        entry: contract.entry,
        capabilities: contract.capabilities,
        packageName: manifest.name,
        packageVersion: manifest.version,
        files,
        bytes: sizes.reduce((sum, value) => sum + value, 0),
        dependencies: Object.entries(manifest.dependencies ?? {}).map(([name, version]) => `${name}@${version}`),
      },
      files: revision.files,
    }
  })
  const review = (input: CreatorPlugin.Source) => prepare(input).pipe(Effect.map((result) => result.review))
  const install = Effect.fn("CreatorPlugins.install")(function* (input: CreatorPlugin.Source) {
    const duplicate = (yield* source.list()).find(
      (item) =>
        item.sessionID === input.sessionID && item.designID === input.designID && item.revision === input.revision,
    )
    if (duplicate) return duplicate
    const prepared = yield* prepare(input)
    const id = CreatorPlugin.ID.make(`cplugin_${crypto.randomUUID()}`)
    const directory = source.directory(id)
    yield* Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => mkdir(directory, { recursive: true }),
        catch: (cause) =>
          new Error({
            code: "unavailable",
            message: `Cannot create the installed package directory: ${String(cause)}`,
          }),
      })
      for (const file of prepared.review.files) {
        const bytes = yield* designs.readBlob(prepared.files[file]!)
        yield* Effect.tryPromise({
          try: () => DesignFiles.atomic(path.join(directory, file), bytes),
          catch: (cause) =>
            new Error({
              code: "unavailable",
              message: `Cannot write installed package file ${file}: ${String(cause)}`,
            }),
        })
      }
      yield* Effect.try({
        try: () => {
          const entry = Host.resolve({ directory }).server
          if (
            !entry ||
            path.relative(directory, fileURLToPath(entry)).split(path.sep).join("/") !== prepared.review.entry
          )
            throw new Error({
              code: "invalid",
              message: "The delivery entry must resolve as the package's server entrypoint (server.js or index.js)",
            })
        },
        catch: (cause) => new Error({ code: "invalid", message: String(cause) }),
      })
    }).pipe(
      Effect.onError(() =>
        Effect.promise(() => removeSnapshot(source.root, directory)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to clean incomplete Creator plugin installation", { directory, cause }),
          ),
        ),
      ),
    )
    const { files: _files, bytes: _bytes, dependencies: _dependencies, ...metadata } = prepared.review
    const item = { ...metadata, id, version: 1, enabled: false, created: Date.now() }
    yield* source.set(item)
    return item
  }, lock.withPermits(1))
  const test = Effect.fn("CreatorPlugins.test")(function* (
    id: CreatorPlugin.ID,
    input: typeof CreatorPlugin.Expected.Type,
  ) {
    const item = yield* read(id, input.expectedVersion)
    if (item.enabled) return yield* new Error({ code: "conflict", message: "Disable this plugin before testing it" })
    const report = yield* probe.run(source.directory(id))
    const next = { ...item, report, version: item.version + 1 }
    yield* source.set(next)
    return next
  }, lock.withPermits(1))
  const control = Effect.fn("CreatorPlugins.control")(function* (
    id: CreatorPlugin.ID,
    input: typeof CreatorPlugin.Control.Type,
  ) {
    const item = yield* read(id, input.expectedVersion)
    if (item.enabled === input.enabled) return item
    if (input.enabled) {
      if (!item.report?.passed || !item.report.pluginID)
        return yield* new Error({
          code: "conflict",
          message: "Run a successful compatibility test before activating this plugin",
        })
      const plugins = yield* runtime.list()
      if (plugins.some((plugin) => plugin.id === item.report?.pluginID && !matches(item, plugin)))
        return yield* new Error({ code: "conflict", message: `Another plugin already uses ID ${item.report.pluginID}` })
    }
    const next = { ...item, enabled: input.enabled, version: item.version + 1 }
    yield* source.set(next)
    yield* supervisor.refresh.pipe(
      Effect.timeout("45 seconds"),
      Effect.mapError(
        () =>
          new Error({
            code: "unavailable",
            message: "Plugin activation is still pending. Refresh to inspect its runtime state.",
          }),
      ),
    )
    return next
  }, lock.withPermits(1))
  const remove = Effect.fn("CreatorPlugins.remove")(function* (
    id: CreatorPlugin.ID,
    input: typeof CreatorPlugin.Expected.Type,
  ) {
    const item = yield* read(id, input.expectedVersion)
    if (item.enabled) yield* source.set({ ...item, enabled: false, version: item.version + 1 })
    yield* supervisor.refresh.pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError(
        () => new Error({ code: "unavailable", message: "Waiting for plugin shutdown. Refresh and retry removal." }),
      ),
    )
    if ((yield* runtime.list()).some((plugin) => matches(item, plugin)))
      return yield* new Error({
        code: "conflict",
        message: "This package is still loaded by another configuration. Remove that reference before deleting it.",
      })
    yield* Effect.tryPromise({
      try: () => removeSnapshot(source.root, source.directory(id)),
      catch: (cause) => new Error({ code: "unavailable", message: `Cannot remove plugin files: ${String(cause)}` }),
    })
    yield* source.remove(id)
  }, lock.withPermits(1))
  return { list, candidates, review, install, test, control, remove }
})

async function removeSnapshot(root: string, directory: string) {
  const base = await realpath(root)
  const target = await realpath(directory)
  if (path.dirname(target) !== base || !/^cplugin_[a-f0-9-]{36}$/.test(path.basename(target)))
    throw new Error({ code: "invalid", message: "Plugin directory is outside managed storage" })
  await rm(target, { recursive: true, force: true })
}
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/CreatorPlugins") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [DesignStore.node, CreatorPluginSource.node, Plugin.node, CreatorPluginProbe.node, PluginSupervisor.node],
})
