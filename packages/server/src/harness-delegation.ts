import type { Database } from "bun:sqlite"
import type { Harness } from "@opencode/schema/harness"
import { Session } from "@opencode/schema/session"
import { z } from "zod"

const Input = z
  .object({
    requestID: z.string().min(1).max(200),
    driver: z.enum(["codex", "claude", "redcode"]),
    task: z.string().trim().min(1),
  })
  .strict()

type Row = {
  id: string
  parent: string
  child: string
  driver: Harness.Driver | "redcode"
  phase: "starting" | "admitted" | "completed" | "failed" | "interrupted" | "unknown"
  error: string | null
  finished_cursor: number | null
  notified: number
}

/** Durable parent ownership for explicitly requested harness-to-harness work. */
export function createHarnessDelegation(
  db: Database,
  input: {
    parent: (id: string) => Pick<Harness.Run, "directory">
    configured: (driver: Harness.Driver) => boolean
    open: (id: string, parent: Pick<Harness.Run, "directory">, driver: Harness.Driver) => Promise<void>
    prompt: (id: string, text: string) => Promise<void>
    read: (id: string) => Harness.Detail
    interrupt: (id: string) => Promise<void>
    deliver: (parent: string, id: string, result: string) => Promise<boolean>
    native?: {
      start: (parent: string, child: string, directory: string, task: string) => Promise<void>
      run: (
        child: string,
        signal: AbortSignal,
      ) => Promise<{ status: "completed" | "failed" | "interrupted"; text: string }>
      recover: (
        child: string,
        signal: AbortSignal,
      ) => Promise<{ status: "completed" | "failed" | "interrupted"; text: string } | undefined>
      interrupt: (child: string) => Promise<boolean>
    }
  },
) {
  db.exec(`CREATE TABLE IF NOT EXISTS harness_delegation (
    id TEXT PRIMARY KEY, parent TEXT NOT NULL, child TEXT NOT NULL UNIQUE,
    driver TEXT NOT NULL, phase TEXT NOT NULL, error TEXT, finished_cursor INTEGER,
    notified INTEGER NOT NULL DEFAULT 0
  )`)
  // An interrupted admission may have launched a process. Never retry it automatically.
  db.query("UPDATE harness_delegation SET phase='unknown' WHERE phase='starting'").run()
  const find = (id: string) => db.query<Row, [string]>("SELECT * FROM harness_delegation WHERE id=?").get(id)
  const owned = (parent: string, id: string) => {
    const row = find(id)
    if (!row || row.parent !== parent) throw new Error("Delegated task not found for this harness")
    return row
  }
  const status = (parent: string, id: string) => {
    const row = owned(parent, id)
    if (row.phase === "starting" || row.phase === "unknown")
      return { taskID: row.id, childID: row.child, driver: row.driver, status: row.phase, error: row.error }
    const detail = row.driver === "redcode" ? undefined : input.read(row.child)
    const state = detail?.run.state ?? "running"
    const events = db
      .query<
        { cursor: number; kind: "text" | "error"; text: string },
        [string, number]
      >("SELECT cursor,kind,text FROM (SELECT cursor,kind,text FROM event WHERE run=? AND cursor<=? AND kind IN ('text','error') ORDER BY cursor DESC LIMIT 20) ORDER BY cursor")
      .all(row.child, row.finished_cursor ?? Number.MAX_SAFE_INTEGER)
    return {
      taskID: row.id,
      childID: row.child,
      driver: row.driver,
      status: row.phase === "admitted" ? state : row.phase,
      error: row.error ?? detail?.run.detail ?? null,
      requests: row.phase === "admitted" ? (detail?.requests ?? []) : [],
      events: events.map((event) => ({ ...event, text: event.text.slice(-4_000) })),
    }
  }
  const delivering = new Set<string>()
  const nativeRuns = new Map<string, AbortController>()
  const pending = new Set<Promise<void>>()
  const admissions = new Set<Promise<unknown>>()
  let stopped = false
  const flushPending = async (parent: string) => {
    const rows = db
      .query<
        Row,
        [string]
      >("SELECT * FROM harness_delegation WHERE parent=? AND phase IN ('completed','failed','interrupted') AND notified=0 ORDER BY rowid")
      .all(parent)
    for (const row of rows) {
      if (delivering.has(row.id)) continue
      delivering.add(row.id)
      try {
        const result = status(parent, row.id)
        if (!(await input.deliver(parent, row.id, JSON.stringify(result)))) return
        db.query("UPDATE harness_delegation SET notified=1 WHERE id=?").run(row.id)
      } finally {
        delivering.delete(row.id)
      }
    }
  }
  const flush = (parent: string) => {
    if (stopped) return Promise.resolve()
    const work = flushPending(parent)
    pending.add(work)
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work),
    )
    return work
  }
  const settle = (child: string, phase: "completed" | "failed" | "interrupted", error?: string) => {
    db.query(
      "UPDATE harness_delegation SET phase=?,error=?,finished_cursor=(SELECT COALESCE(MAX(cursor),0) FROM event WHERE run=?) WHERE child=? AND phase IN ('starting','admitted')",
    ).run(phase, error ?? null, child, child)
    const row = db.query<Row, [string]>("SELECT * FROM harness_delegation WHERE child=?").get(child)
    if (row) void flush(row.parent).catch(() => {})
  }
  const observeNative = (child: string, recovering = false) => {
    if (!input.native || stopped || nativeRuns.has(child)) return
    const controller = new AbortController()
    nativeRuns.set(child, controller)
    const execute = recovering ? input.native.recover : input.native.run
    void execute(child, controller.signal)
      .then(
        (result) => {
          if (controller.signal.aborted) return
          if (!result) {
            db.query("UPDATE harness_delegation SET phase='unknown',error=? WHERE child=? AND phase='admitted'").run(
              "Native session admission could not be reconciled",
              child,
            )
            return
          }
          // Atomically commit the result with its terminal state, including after a crash.
          db.transaction(() => {
            const updated = db
              .query("UPDATE harness_delegation SET phase=?,error=? WHERE child=? AND phase='admitted'")
              .run(result.status, result.status === "failed" ? result.text.slice(-2_000) : null, child)
            if (!updated.changes) return
            db.query("INSERT INTO event(run,kind,text) VALUES (?,?,?)").run(
              child,
              result.status === "failed" ? "error" : "text",
              result.text.slice(-64_000),
            )
            db.query(
              "UPDATE harness_delegation SET finished_cursor=(SELECT COALESCE(MAX(cursor),0) FROM event WHERE run=?) WHERE child=?",
            ).run(child, child)
          })()
          const row = db.query<Row, [string]>("SELECT * FROM harness_delegation WHERE child=?").get(child)
          if (row) void flush(row.parent).catch(() => {})
        },
        (error) => {
          if (controller.signal.aborted) return
          if (recovering) {
            db.query("UPDATE harness_delegation SET phase='unknown',error=? WHERE child=? AND phase='admitted'").run(
              error instanceof Error ? error.message : "Native session recovery failed",
              child,
            )
            return
          }
          settle(child, "failed", error instanceof Error ? error.message : "Native execution failed")
        },
      )
      .finally(() => nativeRuns.delete(child))
  }
  const admit = async (parentID: string, value: unknown, nativeParent?: Pick<Harness.Run, "directory">) => {
    const args = Input.parse(value)
    const existing = find(args.requestID)
    if (existing) return status(parentID, args.requestID)
    const parent = nativeParent ?? input.parent(parentID)
    if (args.driver === "redcode" ? !input.native : !input.configured(args.driver))
      throw new Error(`${args.driver} is not configured on this host`)
    const child = args.driver === "redcode" ? Session.ID.create() : crypto.randomUUID()
    db.query("INSERT INTO harness_delegation(id,parent,child,driver,phase) VALUES (?,?,?,?,?)").run(
      args.requestID,
      parentID,
      child,
      args.driver,
      "starting",
    )
    try {
      if (args.driver === "redcode") await input.native!.start(parentID, child, parent.directory, args.task)
      else {
        await input.open(child, parent, args.driver)
        if (stopped) throw new Error("Host is shutting down")
        await input.prompt(child, args.task)
      }
      if (stopped) throw new Error("Host is shutting down")
      db.query("UPDATE harness_delegation SET phase='admitted' WHERE id=? AND phase='starting'").run(args.requestID)
      if (args.driver === "redcode") observeNative(child)
    } catch (error) {
      // The process or prompt may have started despite an error. Preserve its identity for inspection.
      db.query(
        "UPDATE harness_delegation SET phase='unknown',error=? WHERE id=? AND phase IN ('starting','admitted')",
      ).run(error instanceof Error ? error.message : "Admission failed", args.requestID)
    }
    return status(parentID, args.requestID)
  }
  return {
    delegate(parentID: string, value: unknown, nativeParent?: Pick<Harness.Run, "directory">) {
      if (stopped) return Promise.reject(new Error("Host is shutting down"))
      const work = admit(parentID, value, nativeParent)
      admissions.add(work)
      void work.then(
        () => admissions.delete(work),
        () => admissions.delete(work),
      )
      return work
    },
    status,
    flush,
    recoverableParents() {
      return db
        .query<{ parent: string }, []>(
          "SELECT DISTINCT parent FROM harness_delegation WHERE parent NOT LIKE 'session:%' AND (phase='admitted' OR (phase IN ('completed','failed','interrupted') AND notified=0))",
        )
        .all()
        .map((row) => row.parent)
    },
    recoverySessions() {
      return db
        .query<{ id: string }, []>(
          `
        SELECT child AS id FROM harness_delegation WHERE driver='redcode' AND phase='admitted'
        UNION
        SELECT substr(parent, 9) AS id FROM harness_delegation
        WHERE parent LIKE 'session:%' AND (phase='admitted' OR (phase IN ('completed','failed','interrupted') AND notified=0))
      `,
        )
        .all()
        .map((row) => Session.ID.make(row.id))
    },
    recoverNative() {
      if (stopped || !input.native) return
      const rows = db
        .query<
          { child: string },
          []
        >("SELECT child FROM harness_delegation WHERE driver='redcode' AND phase='admitted'")
        .all()
      rows.forEach(({ child }) => observeNative(child, true))
    },
    async stop() {
      stopped = true
      nativeRuns.forEach((controller) => controller.abort())
      await Promise.allSettled([...admissions])
      await Promise.allSettled([...pending])
    },
    flushNative() {
      const parents = db
        .query<
          { parent: string },
          []
        >("SELECT DISTINCT parent FROM harness_delegation WHERE parent LIKE 'session:%' AND phase IN ('completed','failed','interrupted') AND notified=0")
        .all()
      parents.forEach(({ parent }) => void flush(parent).catch(() => {}))
    },
    settle,
    async cancel(parentID: string, id: string) {
      const row = owned(parentID, id)
      if (["completed", "failed", "interrupted"].includes(row.phase)) return status(parentID, id)
      if (row.phase !== "admitted")
        throw new Error("This delegated task cannot be interrupted while its admission is unresolved")
      const state = row.driver === "redcode" ? "running" : input.read(row.child).run.state
      if (state === "running" || state === "waiting") {
        if (row.driver === "redcode") {
          if (await input.native!.interrupt(row.child)) settle(row.child, "interrupted")
        } else {
          await input.interrupt(row.child)
          settle(row.child, "interrupted")
        }
      }
      return status(parentID, id)
    },
  }
}
