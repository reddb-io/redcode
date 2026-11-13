import path from "node:path"
import { Effect, Layer, Schema } from "effect"
import { Event } from "@opencode/schema/event"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"

const directory = process.argv[2]
if (!directory) throw new Error("Missing test directory")
const definition = Event.ephemeral({ type: "journal.test", schema: { text: Schema.String } })
const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
  Global.node.replace(Layer.succeed(Global.Service, Global.Service.of(Global.make({
    home: directory, data: directory, cache: directory, config: directory, state: directory,
    tmp: directory, bin: directory, log: directory, repos: directory,
  })))),
  Database.node.replace(Database.configured({ path: path.join(directory, "events.db") })),
])

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const bus = yield* Bus.Service
  const consume = yield* bus.consume("consumer", [definition], (event) => Effect.gen(function* () {
    console.log(`DELIVERY_READY:${JSON.stringify(event)}`)
    yield* Effect.never
  }))
  yield* consume.pipe(Effect.forkScoped({ startImmediately: true }))
  yield* bus.publish(definition, { text: "before crash" })
  yield* Effect.promise(() => new Promise<void>(() => setInterval(() => {}, 1000)))
}).pipe(Effect.provide(layer))))
