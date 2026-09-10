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
          if (input.action !== "list" && !input.id) return yield* Effect.die(new Error("Monitor id is required."))
          const result =
            input.action === "list"
              ? yield* monitors.list(context.sessionID)
              : input.action === "get"
                ? yield* monitors.get(context.sessionID, input.id!)
                : input.action === "wait"
                  ? yield* monitors.wait(context.sessionID, input.id!, input.wait_ms ?? 1_000)
                  : yield* monitors.cancel(context.sessionID, input.id!)
          return {
            title: `Monitors: ${input.action}`,
            metadata: {},
            output: JSON.stringify(result ?? { error: "Monitor not found in this session." }),
          }
        }),
    }
  }),
)
