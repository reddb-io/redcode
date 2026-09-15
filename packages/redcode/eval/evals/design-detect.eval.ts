import { task } from "../lib/task"

// design_document detect reads a fixture repo's design system (Tailwind v4 stylesheet, shadcn
// components.json) and writes nothing.
task(
  "design-detect",
  {
    fixture: "design-detect",
    prompt: "Which design system does this repository use? Detect it without changing anything.",
    budget: { steps: 4, ms: 60_000 },
  },
  (run) => {
    run.completed()
    run.toolCalled(
      "design_document",
      (input, call) => input.action === "detect" && /tailwind/i.test(call.output ?? ""),
      { status: "completed" },
    )
    run.toolNotCalled("write")
    run.toolNotCalled("edit")
    run.mentions(/Tailwind/)
    run.noGuardStops({ strict: true })
    run.stepsAtMost(3)
    run.costAtMost(0.05)
  },
)
