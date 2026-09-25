import { describe, expect, test } from "bun:test"
import { Database as SqliteFile } from "bun:sqlite"
import path from "path"
import { Sqlite } from "@reddb-io/redcode-core/database/sqlite"
import { tmpdir } from "./fixture/tmpdir"

describe("Sqlite.failure", () => {
  test("names the statement kind and the SQLite code of a real lock wait that ran out", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "locked.sqlite")
    const holder = new SqliteFile(filename)
    const writer = new SqliteFile(filename)
    try {
      holder.run("PRAGMA journal_mode = WAL")
      holder.run("CREATE TABLE item (id INTEGER PRIMARY KEY)")
      writer.run("PRAGMA busy_timeout = 0")
      holder.run("BEGIN IMMEDIATE")
      const query = "  insert into item (id) values (?)"
      const cause = (() => {
        try {
          writer.query(query).run(1)
        } catch (error) {
          return error
        }
      })()
      expect(Sqlite.failure(cause, query)).toBe(
        "Failed to execute statement (INSERT, SQLITE_BUSY: database is locked)",
      )
    } finally {
      if (holder.inTransaction) holder.run("ROLLBACK")
      writer.close()
      holder.close()
    }
  })

  test("reads node:sqlite's numeric code and never includes parameters", () => {
    const cause = Object.assign(new Error("database is locked"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 5,
      errstr: "database is locked",
    })
    expect(Sqlite.failure(cause, "UPDATE session SET title = ? WHERE id = ?")).toBe(
      "Failed to execute statement (UPDATE, SQLITE_BUSY: database is locked)",
    )
    expect(Sqlite.failure(Object.assign(new Error("disk I/O error"), { errcode: 522 }), "COMMIT")).toBe(
      "Failed to execute statement (COMMIT, SQLITE_IOERR: disk I/O error)",
    )
  })

  test("still names the statement when the cause carries nothing to read", () => {
    expect(Sqlite.failure(undefined, "select 1")).toBe("Failed to execute statement (SELECT)")
    expect(Sqlite.failure({}, "")).toBe("Failed to execute statement (SQL)")
  })
})
