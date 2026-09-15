import { task } from "../lib/task"

// A session with a completed, evidence-backed task is compacted, so the request the task quotes
// leaves the history. The next prompt must still run: the task review before every step used to
// re-validate that stored quote, die, and fail every later prompt in the session (#249).
task(
  "compacted-evidence",
  {
    fixture: "failing-test",
    prompt: "Fix src/sum.sh so `sh test.sh` passes, and track it as a task.",
    turns: [{ compact: true }, { prompt: "Thanks. Is anything left to do?" }],
    budget: { steps: 10, ms: 60_000 },
  },
  async (run) => {
    run.completed()
    const writes = run.record.tools.filter((call) => call.tool === "todowrite")
    const todos = (writes.at(-1)?.metadata?.todos ?? []) as { status: string; evidence?: unknown }[]
    run.that(
      "the task completed with evidence before the compaction",
      todos.length === 1 && todos[0]!.status === "completed" && !!todos[0]!.evidence,
      JSON.stringify(todos),
    )
    run.that(
      "every scripted step was consumed, the summary and the prompt after it included",
      run.record.requests.filter((request) => request.kind === "step").length === 8,
      `${run.record.requests.filter((request) => request.kind === "step").length} step requests`,
    )
    run.mentions("Nothing is left")
    await run.check("sh test.sh")
    run.noGuardStops({ strict: true })
    run.costAtMost(0.1)
  },
)
