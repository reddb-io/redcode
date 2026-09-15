import { task } from "../lib/task"
import { EvalMcp } from "../lib/mcp"

// A 34-tool MCP server is over the tool_search threshold: its schemas stay out of the request
// until the model searches, and the loaded tool is called on the next step.
task(
  "mcp-tool-search",
  {
    prompt: "Close issue 42 in the tracker as completed, with a short comment.",
    mcp: [EvalMcp.trackerServer()],
    budget: { steps: 6, ms: 60_000 },
  },
  (run) => {
    run.completed()
    run.toolCalled("tool_search")
    run.toolCalled("tracker_close_issue", (input) => input.id === 42, { status: "completed" })
    run.that(
      "the tracker server received exactly the close call",
      JSON.stringify(run.mcpCalls("tracker").map((call) => call.tool)) === JSON.stringify(["close_issue"]),
      JSON.stringify(run.mcpCalls("tracker")),
    )
    const steps = run.record.requests.filter((request) => request.kind === "step")
    const advertised = (index: number) => steps[index]?.tools.filter((name) => name.startsWith("tracker_")) ?? []
    run.that(
      "tracker schemas were deferred until the search loaded one",
      steps.length >= 2 && advertised(0).length === 0 && advertised(1).includes("tracker_close_issue"),
      `first request: ${advertised(0).length} tracker tools, second: ${advertised(1).join(", ") || "none"}`,
    )
    run.noGuardStops({ strict: true })
    run.stepsAtMost(4)
    run.costAtMost(0.05)
  },
)
