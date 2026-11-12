export * as CreatorPluginSource from "./plugin-source.js"

import { CreatorPlugin } from "@opencode/schema/creator-plugin"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, PubSub, Schema, Stream } from "effect"
import path from "node:path"
import { Bus } from "../bus.js"
import { KV } from "../kv.js"
import { Location } from "../location.js"
import { DesignFiles } from "../design/files.js"

const make = Effect.gen(function* () {
  const kv = yield* KV.Service
  const location = yield* Location.Service
  const bus = yield* Bus.Service
  const changes = yield* PubSub.unbounded<void>()
  const scope = JSON.stringify([location.directory, location.workspaceID ?? null])
  const prefix = `creator.plugins:${encodeURIComponent(scope)}:`
  const root = path.join(location.directory, ".red", "code", "extensions", DesignFiles.hash(scope))
  const directory = (id: CreatorPlugin.ID) => path.join(root, id)
  const list = Effect.fn("CreatorPluginSource.list")(function* () {
    const result: CreatorPlugin.Info[] = []
    let after: string | undefined
    do {
      const page = yield* kv.scan({ prefix, after, limit: 1000 })
      result.push(...page.entries.map((entry) => Schema.decodeUnknownSync(CreatorPlugin.Info)(entry.value)))
      after = page.next
    } while (after)
    return result
  })
  const notify = (id: CreatorPlugin.ID, runtime: boolean) =>
    (runtime ? PubSub.publish(changes, undefined) : Effect.void).pipe(
      Effect.andThen(bus.publish(CreatorPlugin.Event.Updated, { pluginID: id }, { location })),
      Effect.asVoid,
    )
  return {
    root,
    directory,
    list,
    changes: () => Stream.fromPubSub(changes),
    set: Effect.fn("CreatorPluginSource.set")(function* (info: CreatorPlugin.Info) {
      const previous = yield* kv.get(prefix + info.id)
      yield* kv.set(prefix + info.id, Schema.encodeSync(CreatorPlugin.Info)(info))
      yield* notify(
        info.id,
        (previous ? Schema.decodeUnknownSync(CreatorPlugin.Info)(previous).enabled : false) !== info.enabled,
      )
    }),
    remove: Effect.fn("CreatorPluginSource.remove")(function* (id: CreatorPlugin.ID) {
      const previous = yield* kv.get(prefix + id)
      yield* kv.remove(prefix + id)
      yield* notify(id, previous ? Schema.decodeUnknownSync(CreatorPlugin.Info)(previous).enabled : false)
    }),
  }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/CreatorPluginSource") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [KV.node, Location.node, Bus.node],
})
