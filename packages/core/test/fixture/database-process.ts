// A Redcode process against a shared database file, for tests that need real processes: two of
// them opening one file at the same moment, or appending to one aggregate at the same time. It
// prints "ready" once its modules are loaded, then waits for the gate file to appear, so the
// parent can release several at the same instant and the race is on the database rather than
// on start-up.
//
//   database-process.ts open <file> <gate>
//   database-process.ts append <file> <gate> <writer> <count>
import { existsSync } from "fs"
import { Effect, Layer, Schema } from "effect"
import { Database } from "@reddb-io/redcode-core/database/database"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"

const [mode, filename, gate, writer = "", count = "0"] = process.argv.slice(2)
if (!filename || !gate) throw new Error("usage: database-process.ts <open|append> <file> <gate> [writer] [count]")

export const Appended = EventV2.define({
  type: "test.concurrent",
  durable: { version: 1, aggregate: "id" },
  schema: { id: Schema.String, writer: Schema.String, n: Schema.Number },
})

process.stdout.write("ready\n")
while (!existsSync(gate)) await Bun.sleep(2)

if (mode === "open") {
  await Effect.runPromise(Effect.scoped(Layer.build(Database.layerFromPath(filename))))
} else if (mode === "append") {
  await Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      for (let n = 0; n < Number(count); n++) yield* events.publish(Appended, { id: "shared", writer, n })
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node]), [
          [Database.node, Database.layerFromPath(filename)],
        ]),
      ),
      Effect.scoped,
    ),
  )
} else {
  throw new Error(`unknown mode ${mode}`)
}
