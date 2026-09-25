// A Redcode process against a shared database file, for tests that need real processes: several
// of them opening one file at the same moment, appending to one aggregate, or writing sessions
// and messages at the same time. It prints "ready" once its modules are loaded, then waits for the
// gate file to appear, so the parent can release several at the same instant and the race is on
// the database rather than on start-up.
//
//   database-process.ts open <file> <gate>
//   database-process.ts append <file> <gate> <writer> <count>
//   database-process.ts write <file> <gate> <writer> <milliseconds>
//   database-process.ts hold <file> <gate> <writer> <milliseconds>
//
// `write` inserts messages and parts and updates its session, on their own and in transactions,
// until the time is up, then prints "wrote <n>". `hold` takes the write lock twice and keeps it
// for longer than the busy timeout each time, as a large write on a slow disk would, so a
// writer's statement only gets through by waiting and trying again.
import { existsSync } from "fs"
import { sql } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { Database } from "@reddb-io/redcode-core/database/database"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"

const [mode, filename, gate, writer = "", count = "0"] = process.argv.slice(2)
if (!filename || !gate)
  throw new Error("usage: database-process.ts <open|append|write|hold> <file> <gate> [writer] [count]")

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
} else if (mode === "write" || mode === "hold") {
  const wrote = await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const session = `ses_${writer}`
      const start = Date.now()
      yield* db.run(
        sql`INSERT INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES ('shared', '/shared', '[]', ${start}, ${start}) ON CONFLICT (id) DO NOTHING`,
      )
      yield* db.run(
        sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (${session}, 'shared', ${writer}, '/shared', ${writer}, 'test', ${start}, ${start})`,
      )
      const message = (n: number) =>
        sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (${`msg_${writer}_${n}`}, ${session}, ${Date.now()}, ${Date.now()}, '{}')`

      if (mode === "hold") {
        for (const n of [0, 1]) {
          yield* Effect.sleep(400)
          yield* db.transaction((tx) => tx.run(message(n)).pipe(Effect.andThen(Effect.sleep(Number(count)))))
        }
        return 2
      }

      const until = Date.now() + Number(count)
      let n = 0
      while (Date.now() < until) {
        yield* db.run(message(n))
        yield* db.run(
          sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (${`prt_${writer}_${n}`}, ${`msg_${writer}_${n}`}, ${session}, ${Date.now()}, ${Date.now()}, '{}')`,
        )
        yield* db.run(sql`UPDATE session SET time_updated = ${Date.now()} WHERE id = ${session}`)
        yield* db.transaction((tx) => tx.run(sql`UPDATE session SET title = ${`${writer} ${n}`} WHERE id = ${session}`))
        n++
        yield* Effect.sleep(5)
      }
      return n
    }).pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped),
  )
  process.stdout.write(`wrote ${wrote}\n`)
} else {
  throw new Error(`unknown mode ${mode}`)
}
