import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "fs"
import os from "os"
import path from "path"
import { Usage } from "@reddb-io/redcode-core/usage/usage"
import { UsageBackfill } from "@reddb-io/redcode-core/usage/backfill"

/**
 * The backfill replays what the session stores already hold. These tests pin which files it reads, what it counts,
 * and that a second run is a no-op — the property that makes it safe to re-run.
 */
describe("usage backfill", () => {
  let stores: string

  const assistant = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      role: "assistant",
      modelID: "claude-sonnet-5",
      providerID: "anthropic",
      cost: 0.5,
      tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1_700_000_000_000, completed: 1_700_000_001_000 },
      ...over,
    })

  const store = (name: string, rows: { id: string; session: string; data: string }[]) => {
    const file = path.join(stores, name)
    const database = new Database(file, { create: true })
    database.exec(
      "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL)",
    )
    for (const row of rows) {
      database.query("INSERT INTO message VALUES (?, ?, ?, ?)").run(row.id, row.session, 1_700_000_000_000, row.data)
    }
    database.close()
    return file
  }

  const mirrored = () => {
    const database = new Database(Usage.path(), { readonly: true })
    const rows = database.query<{ id: string }, []>("SELECT id FROM message ORDER BY id").all()
    database.close()
    return rows.map((row) => row.id)
  }

  beforeEach(() => {
    Usage.reset()
    fs.rmSync(path.dirname(Usage.path()), { recursive: true, force: true })
    stores = fs.mkdtempSync(path.join(os.tmpdir(), "redcode-backfill-"))
  })

  afterEach(() => {
    Usage.reset()
    fs.rmSync(path.dirname(Usage.path()), { recursive: true, force: true })
    fs.rmSync(stores, { recursive: true, force: true })
  })

  test("reads every channel store and mirrors the turns that carry usage", () => {
    store("redcode.db", [
      { id: "msg_a", session: "ses_1", data: assistant() },
      { id: "msg_user", session: "ses_1", data: JSON.stringify({ role: "user", time: { created: 1 } }) },
    ])
    store("redcode-beta.db", [{ id: "msg_b", session: "ses_2", data: assistant() }])
    store("opencode.db", [{ id: "msg_legacy", session: "ses_3", data: assistant() }])

    const result = UsageBackfill.run({ directory: stores })

    expect(result.mirrored).toBe(3)
    expect(result.skipped).toBe(1)
    expect(result.stores).toHaveLength(3)
    expect(mirrored()).toEqual(["msg_a", "msg_b", "msg_legacy"])
  })

  test("a second run changes nothing", () => {
    store("redcode.db", [{ id: "msg_a", session: "ses_1", data: assistant() }])

    UsageBackfill.run({ directory: stores })
    const first = mirrored()
    const second = UsageBackfill.run({ directory: stores })

    expect(second.mirrored).toBe(1)
    expect(mirrored()).toEqual(first)
  })

  test("ignores files that are not session stores, and unreadable ones", () => {
    store("redcode.db", [{ id: "msg_a", session: "ses_1", data: assistant() }])
    fs.writeFileSync(path.join(stores, "notes.txt"), "not a database")
    fs.writeFileSync(path.join(stores, "redcode-broken.db"), "not a database either")
    const empty = new Database(path.join(stores, "redcode-empty.db"), { create: true })
    empty.exec("CREATE TABLE other (id TEXT)")
    empty.close()

    const result = UsageBackfill.run({ directory: stores })

    expect(result.stores).toEqual([path.join(stores, "redcode.db")])
    expect(result.mirrored).toBe(1)
  })

  test("a row whose data is not JSON is skipped, not fatal", () => {
    store("redcode.db", [
      { id: "msg_bad", session: "ses_1", data: "{ not json" },
      { id: "msg_ok", session: "ses_1", data: assistant() },
    ])

    const result = UsageBackfill.run({ directory: stores })

    expect(result.mirrored).toBe(1)
    expect(result.skipped).toBe(1)
    expect(mirrored()).toEqual(["msg_ok"])
  })

  test("an empty directory is not an error", () => {
    expect(UsageBackfill.run({ directory: stores })).toEqual({ stores: [], mirrored: 0, skipped: 0 })
    expect(UsageBackfill.stores(path.join(stores, "missing"))).toEqual([])
  })
})
