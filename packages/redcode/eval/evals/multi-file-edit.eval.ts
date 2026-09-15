import { task } from "../lib/task"

// A two-file edit tracked with todos: completing them must pass the evidence gate without a
// refusal, which is exactly the loop the todo evidence gate used to fall into.
task(
  "multi-file-edit",
  {
    fixture: "multi-file-edit",
    prompt:
      'Rename the greet function to welcome in both files under src/, and make it print "welcome <name>" instead of hello. Track the work with todos and verify with `sh verify.sh`.',
    budget: { steps: 12, ms: 60_000 },
  },
  async (run) => {
    run.completed()
    run.toolCalled("todowrite", undefined, { atLeast: 2 })
    run.toolCalled("edit", undefined, { atLeast: 2, status: "completed" })
    run.toolCalled("bash", (input) => input.command.includes("verify.sh"), { status: "completed" })
    const last = [...run.record.tools].reverse().find((call) => call.tool === "todowrite")
    const todos = (last?.metadata?.todos ?? []) as { status: string; evidence?: unknown }[]
    run.that(
      "every todo completed with recorded evidence",
      todos.length === 2 && todos.every((todo) => todo.status === "completed" && todo.evidence),
      JSON.stringify(todos.map((todo) => ({ status: todo.status, evidence: !!todo.evidence }))),
    )
    // Strict: an evidence refusal is a correction, and this eval exists to catch those.
    run.noGuardStops({ strict: true })
    run.fileContains("src/greet.sh", "welcome() {")
    run.fileContains("src/main.sh", 'welcome "$1"')
    await run.check("sh verify.sh")
    run.stepsAtMost(8)
    run.costAtMost(0.1)
  },
)
