import { task } from "../lib/task"

// Waiting on a slow CI command must go through a bash monitor. The cassette first tries a sleep
// loop, which the polling guard refuses; the run then resumes from the monitor's completion.
task(
  "slow-ci-monitor",
  {
    fixture: "slow-ci",
    prompt: "Run the local CI with `sh ci.sh` (it takes a few seconds) and tell me whether it passed.",
    budget: { steps: 8, ms: 60_000 },
  },
  (run) => {
    run.completed()
    run.guardFired("polling", "correct")
    run.toolCalled("bash", (input) => input.monitor?.mode === "once" && input.command.includes("ci.sh"))
    run.toolNotCalled("bash", (input, call) => /\bsleep\b/.test(input.command) && !input.monitor && call.status === "completed")
    run.that(
      "the monitor succeeded and resumed the session",
      run.record.monitors.length === 1 && run.record.monitors[0]!.status === "succeeded",
      JSON.stringify(run.record.monitors),
    )
    run.mentions("CI PASSED")
    run.noGuardStops()
    run.finishedWithin(45_000)
    run.costAtMost(0.1)
  },
)
