import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Global } from "@reddb-io/redcode-core/global"
import { Usage } from "@reddb-io/redcode-core/usage/usage"

/**
 * The sidecar is a contract with the outside world: a usage reporter opens this file and reads these columns.
 * The tests pin the layout and the record shape, not the implementation.
 */
describe("usage sidecar", () => {
  // `Global.Path.data` resolves at module scope (see test/preload.ts), so the suite works inside the shared test
  // home and clears the sidecar between cases instead of moving it.
  beforeEach(() => {
    Usage.reset()
    fs.rmSync(path.dirname(Usage.path()), { recursive: true, force: true })
  })

  afterEach(() => {
    Usage.reset()
    fs.rmSync(path.dirname(Usage.path()), { recursive: true, force: true })
  })

  const assistant = (over: Record<string, unknown> = {}) => ({
    role: "assistant",
    modelID: "claude-sonnet-5",
    providerID: "anthropic",
    cost: 0.25,
    tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 7, write: 3 } },
    time: { created: 1_700_000_000_000, completed: 1_700_000_001_000 },
    ...over,
  })

  type Row = { id: string; session_id: string; time_created: number; data: string }

  const read = (): Row[] => {
    const database = new Database(Usage.path(), { readonly: true })
    const rows = database.query<Row, []>("SELECT id, session_id, time_created, data FROM message ORDER BY time_created").all()
    database.close()
    return rows
  }

  test("writes one row per assistant message, in the reader's column layout", () => {
    Usage.recordMessage({ id: "msg_1", sessionID: "ses_1", timeCreated: 1_700_000_000_000, info: assistant() })

    const rows = read()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe("msg_1")
    expect(rows[0].session_id).toBe("ses_1")
    expect(rows[0].time_created).toBe(1_700_000_000_000)

    const data = JSON.parse(rows[0].data)
    expect(data).toEqual({
      id: "msg_1",
      sessionID: "ses_1",
      role: "assistant",
      modelID: "claude-sonnet-5",
      providerID: "anthropic",
      cost: 0.25,
      tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 7, write: 3 } },
      time: { created: 1_700_000_000_000, completed: 1_700_000_001_000 },
    })
  })

  test("carries no message content", () => {
    Usage.recordMessage({
      id: "msg_2",
      sessionID: "ses_1",
      timeCreated: 1_700_000_000_000,
      info: assistant({ path: { cwd: "/secret/project" }, agent: "build", summary: "a private prompt" }),
    })

    expect(read()[0]!.data).not.toContain("secret")
    expect(read()[0]!.data).not.toContain("private")
  })

  test("re-publishing a message updates its row instead of adding one", () => {
    Usage.recordMessage({ id: "msg_3", sessionID: "ses_1", timeCreated: 1_700_000_000_000, info: assistant() })
    Usage.recordMessage({
      id: "msg_3",
      sessionID: "ses_1",
      timeCreated: 1_700_000_000_000,
      info: assistant({ cost: 0.5, tokens: { input: 200, output: 40, reasoning: 0, cache: { read: 0, write: 0 } } }),
    })

    const rows = read()
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].data).cost).toBe(0.5)
  })

  test("skips user messages and turns that reported no usage", () => {
    expect(Usage.recordMessage({ id: "u", sessionID: "s", timeCreated: 1, info: { role: "user" } })).toBeUndefined()
    expect(
      Usage.recordMessage({
        id: "empty",
        sessionID: "s",
        timeCreated: 1,
        info: assistant({ cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
      }),
    ).toBeUndefined()
    expect(fs.existsSync(Usage.path())).toBe(false)
  })

  test("REDCODE_DISABLE_USAGE_SIDECAR writes nothing", () => {
    process.env.REDCODE_DISABLE_USAGE_SIDECAR = "1"
    try {
      Usage.recordMessage({ id: "msg_4", sessionID: "ses_1", timeCreated: 1_700_000_000_000, info: assistant() })
      expect(fs.existsSync(Usage.path())).toBe(false)
    } finally {
      delete process.env.REDCODE_DISABLE_USAGE_SIDECAR
    }
  })

  test("lives beside the session store, under the name a usage reader looks for", () => {
    expect(Usage.path()).toBe(path.join(Global.Path.data, "usage", "opencode.db"))
    expect(Usage.path().endsWith(path.join("data", "usage", "opencode.db"))).toBe(true)
  })
})
