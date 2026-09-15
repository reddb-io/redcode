import { task } from "../lib/task"

// Recovery: the first test run fails, the model must read, fix and rerun until it passes.
task(
  "failing-test-recovery",
  {
    fixture: "failing-test",
    prompt: "`sh test.sh` is failing. Find the bug, fix it, and confirm the test passes.",
    budget: { steps: 10, ms: 60_000 },
  },
  async (run) => {
    run.completed()
    run.toolCalled("bash", (input) => input.command.includes("test.sh"), { atLeast: 2 })
    run.that(
      "the first test run failed and a later one passed",
      run.record.tools.some((call) => call.tool === "bash" && /FAIL/.test(call.output ?? "")) &&
        run.record.tools.some((call) => call.tool === "bash" && /PASS/.test(call.output ?? "")),
    )
    run.toolCalled("edit")
    run.fileContains("src/sum.sh", "$1 + $2")
    await run.check("sh test.sh")
    run.mentions(/pass/i)
    run.noGuardStops()
    run.stepsAtMost(8)
    run.costAtMost(0.05)
    run.finishedWithin(60_000)
  },
)
