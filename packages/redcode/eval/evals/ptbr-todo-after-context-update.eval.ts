import { task } from "../lib/task"
import { EvalMcp } from "../lib/mcp"

// A fresh legacy session gains a projected context.updated row: an MCP server connects between
// turns, so the next step carries a <system_update> (the cassette only answers a request that
// has one). A todowrite whose requirement quotes the PT-BR request must then succeed first time.
// Before #253, any projected row hid every legacy request from the task gate and the quote was
// refused until the loop guard took over.
task(
  "ptbr-todo-after-context-update",
  {
    fixture: "failing-test",
    prompt: "oi",
    turns: [
      {
        mcp: [EvalMcp.trackerServer()],
        prompt: "Corrija o src/sum.sh para que o `sh test.sh` passe, e acompanhe isso como tarefa.",
      },
    ],
    budget: { steps: 10, ms: 60_000 },
    knownFailure: "#253",
  },
  async (run) => {
    run.completed()
    run.toolCalled("todowrite", undefined, { times: 2, status: "completed" })
    run.toolNotCalled("todowrite", (_input, call) => call.status === "error")
    const todos = ([...run.record.tools].reverse().find((call) => call.tool === "todowrite")?.metadata?.todos ?? []) as {
      status: string
      evidence?: unknown
    }[]
    run.that(
      "the PT-BR task completed with evidence",
      todos.length === 1 && todos[0]!.status === "completed" && !!todos[0]!.evidence,
      JSON.stringify(todos),
    )
    await run.check("sh test.sh")
    run.noGuardStops({ strict: true })
    run.stepsAtMost(8)
  },
)
