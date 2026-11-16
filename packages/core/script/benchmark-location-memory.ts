// Measures the heap retained by Location service graphs and by the models.dev
// source plugin. Everything runs against a temporary global directory with a
// temporary home, an in-memory database, no filesystem watchers, and no network,
// so it never touches a live server, database, or user configuration.
//
//   bun run script/benchmark-location-memory.ts [--locations 6] [--plugins 8] [--cycles 1] [--json out.json]
//
// "retained" numbers are heapUsed after two forced GCs. RSS is reported separately.
// Source definitions and materialized candidates are counted independently: the
// source plugin alone may have no available providers in an unauthenticated run.
import fs from "fs/promises"
import os from "os"
import path from "path"
import { heapStats } from "bun:jsc"
import { spyOn } from "bun:test"
import { Effect, Layer, Logger, Schema, Scope } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Bus } from "../src/bus"
import { Database } from "../src/database/database"
import { Config } from "../src/config"
import { InstructionDiscovery } from "../src/instruction-discovery"
import { Integration } from "../src/integration"
import { Location } from "../src/location"
import { LocationServiceMap } from "../src/location-service-map"
import { ModelsDev } from "../src/models-dev"
import { Model } from "../src/model"
import { Plugin } from "../src/plugin"
import { PluginInternal } from "../src/plugin/internal"
import { ModelsDevPlugin } from "../src/plugin/models-dev"
import { Provider } from "../src/provider"
import { AbsolutePath } from "../src/schema"
import { Watcher } from "../src/filesystem/watcher"
import * as ToolRuntime from "../src/tool/runtime"
import { location } from "../test/fixture/location"
import { providerHost, host, integrationHost } from "../test/plugin/host"

const args = process.argv.slice(2)
const flag = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(args[index + 1])
  if (!Number.isInteger(value) || value < 1) {
    console.error(`--${name} must be a positive integer`)
    process.exit(1)
  }
  return value
}
const locationCount = flag("locations", 6)
const pluginCount = flag("plugins", 8)
const cycleCount = flag("cycles", 1)
const profilePlugins = args.includes("--profile-plugins")
const forceGc = !args.includes("--no-forced-gc")
const countNodeLookups = args.includes("--count-node-lookups")
const countSchemas = args.includes("--count-schemas")
const jsonIndex = args.indexOf("--json")
const jsonPath = jsonIndex === -1 ? undefined : args[jsonIndex + 1]

type Sample = { heapUsed: number; rss: number; objects: number }
type Population = {
  providers: number
  definitions: number
  availableProviders: number
  models: number
  availableModels: number
}

const sample = (): Sample => {
  if (forceGc) {
    Bun.gc(true)
    Bun.gc(true)
  }
  const usage = process.memoryUsage()
  return { heapUsed: usage.heapUsed, rss: usage.rss, objects: forceGc ? heapStats().objectCount : 0 }
}

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(2).padStart(8)

const nodeLookups = { count: 0, milliseconds: 0 }
const schemaConversions = { count: 0, effect: 0, repeatedEffect: 0, milliseconds: 0 }
if (countSchemas) {
  const seen = new WeakSet<object>()
  const original = ToolRuntime.definition
  spyOn(ToolRuntime, "definition").mockImplementation((tool) => {
    schemaConversions.count++
    if (Schema.isSchema(tool.input)) {
      schemaConversions.effect++
      if (seen.has(tool.input)) schemaConversions.repeatedEffect++
      else seen.add(tool.input)
    }
    const start = performance.now()
    try {
      return original(tool)
    } finally {
      schemaConversions.milliseconds += performance.now() - start
    }
  })
}
if (countNodeLookups) {
  const original = Bun.which
  spyOn(Bun, "which").mockImplementation((command, options) => {
    if (command !== "node") return original(command, options)
    const start = performance.now()
    try {
      return original(command, options)
    } finally {
      nodeLookups.count++
      nodeLookups.milliseconds += performance.now() - start
    }
  })
}

// Diagnostic only: intercept the internal definitions in this process. No runtime
// source is modified, and forced GCs make these values unsuitable as timing data.
const pluginSamples: { id: string; delta: number }[] = []
let recordPlugins = false
if (profilePlugins) {
  const original = PluginInternal.list
  spyOn(PluginInternal, "list").mockImplementation(() =>
    original().pipe(Effect.map((list) => {
      const wrap = (plugins: typeof list.pre) => plugins.map((plugin) => ({
        ...plugin,
        effect: (host: Parameters<typeof plugin.effect>[0]) => Effect.suspend(() => {
          if (!recordPlugins) return plugin.effect(host)
          const before = sample().heapUsed
          return plugin.effect(host).pipe(Effect.onExit(() => Effect.sync(() => {
            pluginSamples.push({ id: plugin.id, delta: sample().heapUsed - before })
          })))
        }),
      }))
      return { pre: wrap(list.pre), post: wrap(list.post) }
    })),
  )
}

const median = (values: ReadonlyArray<number>) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle] ?? 0
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + upper) / 2 : upper
}

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-location-memory-")))
const globalLayer = Global.layerWith({
  home: path.join(root, "home"),
  data: path.join(root, "data"),
  cache: path.join(root, "cache"),
  config: path.join(root, "config"),
  state: path.join(root, "state"),
  tmp: path.join(root, "tmp"),
  bin: path.join(root, "cache", "bin"),
  log: path.join(root, "data", "log"),
  repos: path.join(root, "data", "repos"),
})
const replacements = [
  Global.node.replace(globalLayer),
  Config.node.replace(Config.configured({ project: false, global: false })),
  InstructionDiscovery.node.replace(InstructionDiscovery.configured({ project: false, global: false })),
  ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
  Watcher.node.replace(Watcher.configured({ enabled: false })),
]

const population = Effect.gen(function* () {
  const providers = yield* Provider.Service
  const models = yield* Model.Service
  const snapshot = yield* providers.snapshot()
  return {
    providers: snapshot.records.size,
    definitions: Array.from(snapshot.records.values()).reduce((total, record) => total + record.models.size, 0),
    availableProviders: snapshot.available.length,
    models: (yield* models.all()).length,
    availableModels: (yield* models.available()).length,
  } satisfies Population
})

// Short-lived borrowers simulate completed API requests. Graphs stay in the host
// cache until explicit eviction, independently of those borrowers.
const locationsProgram = Effect.gen(function* () {
  const locations = yield* LocationServiceMap.Service
  const before = sample()
  const deltas: number[] = []
  const rss: number[] = []
  const populations: Population[] = []
  const phases: { context: number; pluginService: number; activation: number; population: number }[] = []
  let previous = before
  for (let index = 0; index < locationCount; index++) {
    recordPlugins = profilePlugins && index === 1 && pluginSamples.length === 0
    const directory = path.join(root, "projects", `location-${index}`)
    yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
    populations.push(
      yield* Effect.gen(function* () {
        const context = yield* locations.contextEffect(Location.Ref.make({ directory: AbsolutePath.make(directory) }))
        const contextSample = sample()
        const plugins = yield* Plugin.Service.pipe(Effect.provideContext(context))
        const pluginService = sample()
        yield* plugins.awaitActivation
        const activation = sample()
        // Force the actual read models before sampling, including lazy materialization.
        const result = yield* population.pipe(Effect.provideContext(context))
        const current = sample()
        phases.push({
          context: contextSample.heapUsed - previous.heapUsed,
          pluginService: pluginService.heapUsed - contextSample.heapUsed,
          activation: activation.heapUsed - pluginService.heapUsed,
          population: current.heapUsed - activation.heapUsed,
        })
        return result
      }).pipe(Effect.scoped),
    )
    const current = sample()
    recordPlugins = false
    deltas.push(current.heapUsed - previous.heapUsed)
    rss.push(current.rss)
    previous = current
  }
  yield* Effect.forEach(
    Array.from({ length: locationCount }, (_, index) =>
      Location.Ref.make({ directory: AbsolutePath.make(path.join(root, "projects", `location-${index}`)) }),
    ),
    (ref) => locations.invalidate(ref),
    { discard: true },
  )
  yield* Effect.yieldNow
  return {
    before,
    after: previous,
    deltas,
    rss,
    populations,
    phases,
    afterEviction: sample(),
  }
}).pipe(Effect.scoped)

// The models.dev plugin alone, against real Provider, Model and Integration states
// per instance, isolates shared definitions and materialization from the full graph.
const pluginProgram = Effect.gen(function* () {
  const modelsDev = yield* ModelsDev.Service
  const snapshot = yield* modelsDev.get()
  const scope = yield* Scope.Scope
  const before = sample()
  const deltas: number[] = []
  const populations: Population[] = []
  const phases: { services: number; plugin: number; integrations: number; population: number }[] = []
  let previous = before
  for (let index = 0; index < pluginCount; index++) {
    const directory = AbsolutePath.make(path.join(root, "plugins", `instance-${index}`))
    const locationLayer = Layer.succeed(
      Location.Service,
      Location.Service.of(location(Location.Ref.make({ directory }))),
    )
    const context = yield* Layer.build(
      AppNodeBuilder.build(LayerNode.group([Provider.node, Model.node, Integration.node, Bus.node]), [
        Location.node.replace(locationLayer),
        ...replacements,
      ]),
    ).pipe(Scope.provide(scope))
    const providers = yield* Provider.Service.pipe(Effect.provideContext(context))
    const integration = yield* Integration.Service.pipe(Effect.provideContext(context))
    const services = sample()
    yield* ModelsDevPlugin.effect(
      host({ provider: providerHost(providers), integration: integrationHost(integration) }),
    ).pipe(Effect.provideService(ModelsDev.Service, modelsDev), Effect.provideContext(context), Scope.provide(scope))
    const plugin = sample()
    yield* integration.list()
    const integrations = sample()
    populations.push(yield* population.pipe(Effect.provideContext(context)))
    const current = sample()
    phases.push({
      services: services.heapUsed - previous.heapUsed,
      plugin: plugin.heapUsed - services.heapUsed,
      integrations: integrations.heapUsed - plugin.heapUsed,
      population: current.heapUsed - integrations.heapUsed,
    })
    deltas.push(current.heapUsed - previous.heapUsed)
    previous = current
  }
  return {
    before,
    after: previous,
    deltas,
    phases,
    populations,
    snapshot: {
      providers: snapshot.length,
      models: snapshot.reduce((total, provider) => total + provider.models.length, 0),
    },
  }
}).pipe(Effect.scoped)

const program = Effect.gen(function* () {
  const plugin = yield* pluginProgram.pipe(
    Effect.provide(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, ModelsDev.node]), replacements)),
  )
  const cycles = yield* Effect.forEach(Array.from({ length: cycleCount }), () => locationsProgram).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, LocationServiceMap.node]), replacements),
    ),
  )
  return { plugin, locations: cycles[0]!, cycles }
}).pipe(
  Effect.provide(Logger.layer([])),
  Effect.provideService(
    FetchHttpClient.Fetch,
    Object.assign(() => Promise.reject(new Error("Network disabled in location memory benchmark")), {
      preconnect: () => {},
    }),
  ),
)

const result = await Effect.runPromise(program)
await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)

if (!forceGc) console.log("Forced GC and object counting disabled: heap samples are not retained-memory measurements.")
if (countNodeLookups) console.log(`Node executable lookups: ${nodeLookups.count}, ${nodeLookups.milliseconds.toFixed(2)} ms total`)
if (countSchemas) console.log(`Tool definitions: ${JSON.stringify(schemaConversions)}`)
console.log(
  `models.dev snapshot: ${result.plugin.snapshot.providers} providers, ${result.plugin.snapshot.models} models`,
)
console.log(`ModelsDevPlugin instances: ${pluginCount}`)
console.log(`  populations: ${JSON.stringify(result.plugin.populations)}`)
console.log(`  ${forceGc ? "retained heap" : "heap"} per instance (MiB): ${result.plugin.deltas.map((delta) => mib(delta).trim()).join(", ")}`)
console.log(`  median per instance: ${mib(median(result.plugin.deltas))} MiB`)
console.log(`Location graphs: ${locationCount}`)
console.log(`  populations: ${JSON.stringify(result.locations.populations)}`)
console.log(
  `  ${forceGc ? "retained heap" : "heap"} per location (MiB): ${result.locations.deltas.map((delta) => mib(delta).trim()).join(", ")}`,
)
console.log(`  median per location: ${mib(median(result.locations.deltas))} MiB`)
console.log(
  `  heapUsed before ${mib(result.locations.before.heapUsed)} MiB -> after ${mib(result.locations.after.heapUsed)} MiB`,
)
console.log(`  rss before ${mib(result.locations.before.rss)} MiB -> after ${mib(result.locations.after.rss)} MiB`)
console.log(`  heapUsed after eviction: ${mib(result.locations.afterEviction.heapUsed)} MiB`)
console.log(`  rss after eviction: ${mib(result.locations.afterEviction.rss)} MiB`)
console.log(`Repeated load/eviction cycles: ${cycleCount}`)
console.log(
  `  ${forceGc ? "retained heap" : "heap"} after each eviction (MiB): ${result.cycles.map((cycle) => mib(cycle.afterEviction.heapUsed).trim()).join(", ")}`,
)

if (jsonPath) {
  await fs.mkdir(path.dirname(jsonPath), { recursive: true })
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        revision: process.env.OPENCODE_BENCH_REVISION,
        bun: Bun.version,
        bunRevision: Bun.revision,
        locationCount,
        pluginCount,
        cycleCount,
        forceGc,
        ...(countNodeLookups ? { nodeLookups } : {}),
        ...(countSchemas ? { schemaConversions } : {}),
        pluginSamples,
        ...result,
      },
      null,
      2,
    ),
  )
}
