import { Effect } from "effect"
import { Monitor } from "@reddb-io/redcode-schema/monitor"
import { MonitorRuntime } from "@/background/monitor"
import { Tool } from "./tool"

export const MonitorTool = Tool.define(
  "monitor",
  Effect.gen(function* () {
    const monitors = yield* MonitorRuntime.Service
    return {
      description: Monitor.instructions,
      parameters: Monitor.Control,
      execute: (input: typeof Monitor.Control.Type, context: Tool.Context) =>
        Effect.gen(function* () {
          const title = `Monitors: ${input.action}`
          if (input.action === "list")
            return { title, metadata: {}, output: Monitor.renderList(yield* monitors.list(context.sessionID)) }
          if (!input.id) return yield* Effect.die(new Error("Monitor id is required."))
          const result =
            input.action === "get"
              ? yield* monitors.get(context.sessionID, input.id)
              : input.action === "wait"
                ? yield* monitors.wait(context.sessionID, input.id, input.wait_ms ?? 1_000)
                : yield* monitors.cancel(context.sessionID, input.id)
          return {
            title,
            metadata: {},
            output: result ? Monitor.render(result) : JSON.stringify({ error: "Monitor not found in this session." }),
          }
        }),
    }
  }),
)
