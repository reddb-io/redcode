import path from "node:path"
import { Effect, Layer } from "effect"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"

const directory = process.argv[2]
if (!directory) throw new Error("Missing test directory")
const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
  Global.node.replace(
    Layer.succeed(
      Global.Service,
      Global.Service.of(
        Global.make({
          home: directory,
          data: directory,
          cache: directory,
          config: directory,
          state: directory,
          tmp: directory,
          bin: directory,
          log: directory,
          repos: directory,
        }),
      ),
    ),
  ),
  Database.node.replace(Database.configured({ path: path.join(directory, "events.db") })),
  Bus.node.replace(Bus.configured({ persist: true })),
])

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const event = yield* bus.publish(SessionEvent.Renamed, {
        sessionID: Session.ID.make("ses_restart_journal"),
        title: "committed before process termination",
      })
      console.log(`EVENT_READY:${JSON.stringify(event)}`)
      // Keep the database open until the parent terminates this process.
      yield* Effect.promise(() => new Promise<void>(() => setInterval(() => {}, 1000)))
    }).pipe(Effect.provide(layer)),
  ),
)
