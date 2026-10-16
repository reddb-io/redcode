import { Effect, Layer } from "effect"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SessionStore } from "@opencode/core/session/store"
import { Session } from "@opencode/schema/session"

await Effect.runPromise(
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const id = Session.ID.make(process.argv[3])
    if (!(yield* store.acquireExecution(id))) return yield* Effect.die("Could not acquire fixture session")
    yield* store.claim(id)
    const timer = setInterval(() => {}, 1000)
    yield* Effect.addFinalizer(() => Effect.sync(() => clearInterval(timer)))
    process.stdout.write("SESSION_OWNER_READY\n")
    yield* Effect.never
  }).pipe(
    Effect.scoped,
    Effect.provide(
      AppNodeBuilder.build(SessionStore.node, [
        Database.node.replace(Database.configured({ path: process.argv[2] })),
      ]).pipe(Layer.fresh),
    ),
  ),
)
