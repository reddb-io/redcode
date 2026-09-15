import { task } from "../lib/task"

// Plan writes its plan file and hands off through plan_exit; the approval question is answered
// automatically and the turn must continue in Build, carry the plan's task, and finish it with
// evidence instead of freezing on the dialog.
task(
  "plan-handoff",
  {
    agent: "plan",
    fixture: "plan-handoff",
    prompt: "Plan an idempotent payment endpoint in src/pay.sh, then implement it in Build once I approve.",
    answer: ({ options }) => options.find((option) => /^yes/i.test(option)) ?? options[0] ?? "Yes",
    budget: { steps: 10, ms: 60_000 },
  },
  async (run) => {
    run.completed()
    run.toolCalled("plan_exit", undefined, { times: 1, status: "completed" })
    const questions = run.record.interactions.filter((item) => item.kind === "question")
    run.that("the approval question was asked and answered once", questions.length === 1, JSON.stringify(questions))
    run.that(
      "the session moved from plan to build",
      run.record.agents[0] === "plan" && run.record.agents.at(-1) === "build",
      run.record.agents.join(" -> "),
    )
    const last = [...run.record.tools].reverse().find((call) => call.tool === "todowrite")
    const todos = (last?.metadata?.todos ?? []) as { status: string }[]
    run.that(
      "the plan's task arrived in Build and was completed",
      todos.length === 1 && todos[0]!.status === "completed",
      JSON.stringify(todos),
    )
    await run.check("sh src/pay.sh | grep -q 'charged once'")
    run.noGuardStops({ strict: true })
    run.finishedWithin(30_000)
    run.costAtMost(0.1)
  },
)
