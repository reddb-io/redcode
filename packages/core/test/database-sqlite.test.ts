import { expect, test } from "bun:test"
import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { isSqlError } from "effect/unstable/sql/SqlError"
import { Sqlite } from "@opencode/core/database/sqlite"
import { sqliteLayer } from "@opencode/core/database/sqlite.bun"

test("names the statement kind, SQLite code and reason of a refused statement", () => {
  expect(Sqlite.failure({ code: "SQLITE_BUSY", message: "database is locked" }, "insert into item values (?)")).toBe(
    "Failed to execute statement (INSERT, SQLITE_BUSY: database is locked)",
  )
  expect(Sqlite.failure({ errcode: 5, errstr: "database is locked" }, "  UPDATE item SET id = 1")).toBe(
    "Failed to execute statement (UPDATE, SQLITE_BUSY: database is locked)",
  )
  expect(Sqlite.failure({ errcode: 261, errstr: "database is locked" }, "begin immediate")).toBe(
    "Failed to execute statement (BEGIN, SQLITE_BUSY: database is locked)",
  )
  expect(Sqlite.failure("unknown", "-- comment")).toBe("Failed to execute statement (SQL)")
})

test("reports a failed statement with its kind and SQLite code", async () => {
  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE item (id INTEGER PRIMARY KEY)`
      yield* sql`INSERT INTO item (id) VALUES (1)`
      return yield* sql`INSERT INTO item (id) VALUES (1)`.pipe(Effect.flip)
    }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

  if (!isSqlError(error)) throw new Error("Expected SqlError")
  expect(error.reason.message).toContain("Failed to execute statement (INSERT, SQLITE_CONSTRAINT")
})
