import { expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { sqliteLayer } from "@opencode/core/database/sqlite.bun"

test("SQLite streams stop reading when the consumer stops", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE item (id INTEGER PRIMARY KEY)`
      yield* sql`INSERT INTO item (id) VALUES (1), (2)`
      const rows = yield* sql<{
        id: number
      }>`SELECT CASE WHEN id = 1 THEN id ELSE json_extract('invalid', '$') END AS id FROM item`.stream.pipe(
        Stream.take(1),
        Stream.runCollect,
      )
      return Array.from(rows)
    }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

  expect(result).toEqual([{ id: 1 }])
})
