import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { Sqlite } from "@opencode/core/database/sqlite"
import { sqliteLayer } from "@opencode/core/database/sqlite.bun"

test("SQLite streams stop reading when the consumer stops", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const native = (yield* Sqlite.Native) as Database
      const sql = yield* SqlClient.SqlClient
      native.run("CREATE TABLE item (id INTEGER PRIMARY KEY)")
      native.run(
        "WITH RECURSIVE numbers(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM numbers WHERE id < 100) INSERT INTO item SELECT id FROM numbers",
      )
      let visited = 0
      native.function("visit", (id: number) => {
        visited++
        return id
      })
      const rows = yield* sql<{ id: number }>`SELECT visit(id) AS id FROM item`.stream.pipe(
        Stream.take(1),
        Stream.runCollect,
      )
      return { rows: Array.from(rows), visited }
    }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

  expect(result.rows).toEqual([{ id: 1 }])
  expect(result.visited).toBeLessThan(100)
})
