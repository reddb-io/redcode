import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SubagentReview } from "@opencode/schema/subagent-review"
import { TaskContext } from "@opencode/schema/task-context"
import { tmpdir } from "./fixture/tmpdir"

test("a new process resumes background children after graceful shutdown and delivers each result once", async () => {
  await using directory = await tmpdir("subagent-recovery-")
  const path = `${directory.path}/recovery.db`
  const run = async (mode: "shutdown" | "recover") => {
    const child = Bun.spawn([process.execPath, `${import.meta.dir}/fixture/subagent-recovery.ts`, mode, path], {
      env: { ...process.env, OPENCODE_DB: undefined },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(stderr).toBe("")
    expect(code).toBe(0)
    return stdout.trim().split("\n").at(-1)
  }
  const shutdown = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Struct({ before: Schema.Array(Schema.String), context: TaskContext.Info })),
  )(await run("shutdown"))
  expect(shutdown.before).toHaveLength(2)
  // The first process has exited and closed SQLite. Inspect what it actually left on disk.
  using database = new Database(path, { readonly: true })
  expect(database.query("SELECT key FROM kv WHERE key LIKE 'job.background/%'").all()).toHaveLength(2)
  expect(database.query("SELECT id FROM session_inbox").all()).toHaveLength(0)
  const rows = Schema.decodeUnknownSync(
    Schema.Array(Schema.Struct({ metadata: Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)) })),
  )(database.query("SELECT metadata FROM session_v2 WHERE parent_id IS NOT NULL").all())
  for (const row of rows) {
    expect(SubagentReview.read(row.metadata)?.completion).toBeUndefined()
    expect(SubagentReview.read(row.metadata)?.task?.context).toEqual(shutdown.context)
  }
  database.close()

  const recovered = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        started: Schema.Array(Schema.String),
        attempts: Schema.Array(Schema.Number),
        notices: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            payload: Schema.Struct({ metadata: Schema.Struct({ state: Schema.String }) }),
          }),
        ),
        pending: Schema.Number,
        context: TaskContext.Info,
        childContexts: Schema.Array(TaskContext.Info),
      }),
    ),
  )(await run("recover"))
  expect(recovered.started.filter((id) => id !== "ses_process_parent").toSorted()).toEqual([
    "ses_process_child_one",
    "ses_process_child_two",
  ])
  expect(recovered.started).toContain("ses_process_parent")
  expect(recovered.attempts).toEqual([1, 1, 1])
  expect(recovered.notices.map((notice) => notice.id).toSorted()).toEqual(shutdown.before.toSorted())
  expect(recovered.notices.map((notice) => notice.payload.metadata.state)).toEqual(["completed", "completed"])
  expect(recovered.pending).toBe(0)
  expect(recovered.context).toEqual(shutdown.context)
  expect(recovered.childContexts).toEqual([shutdown.context, shutdown.context])
}, 20_000)
