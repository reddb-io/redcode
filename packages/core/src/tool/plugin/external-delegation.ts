export * as ExternalDelegationTool from "./external-delegation.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { ExternalDelegation } from "../../external-delegation.js"
import { Permission } from "../../permission.js"

const Input = Schema.Struct({
  action: Schema.Literals(["delegate", "status", "cancel"]),
  driver: Schema.optionalKey(Schema.Literals(["codex", "claude"])),
  task: Schema.optionalKey(Schema.String),
  taskID: Schema.optionalKey(Schema.String),
})

export const Plugin = {
  id: "redcode.tool.external-delegation",
  effect: Effect.fn("ExternalDelegationTool.Plugin")(function* (ctx: Context) {
    const gateway = yield* ExternalDelegation.Service
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: "external_delegate",
          description:
            "Delegate work to a configured Codex or Claude harness on this host and checkout, or inspect or cancel a task previously delegated by this session. A completed background task reports its result back to this session. For a native Redcode subagent use subagent; do not create a separate user conversation for delegated work.",
          input: Input,
          output: Schema.String,
          options: { codemode: false },
          execute: (input, context) =>
            Effect.gen(function* () {
              const adapter = gateway.get()
              if (!adapter)
                return yield* new ToolFailure({ message: "External harness delegation is unavailable in this host" })
              if (input.action === "delegate") {
                if (!input.driver || !input.task?.trim())
                  return yield* new ToolFailure({ message: "Provide driver and task" })
                yield* permission
                  .assert({
                    action: "external_delegate",
                    resources: [input.driver],
                    save: [input.driver],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.messageID, id: context.id },
                  })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: "Delegation denied", error })))
                const result = yield* Effect.tryPromise({
                  try: () =>
                    adapter.delegate(context.sessionID, ctx.location.directory, {
                      requestID: `native:${createHash("sha256")
                        .update(JSON.stringify([context.sessionID, context.messageID, context.id]))
                        .digest("hex")}`,
                      driver: input.driver!,
                      task: input.task!,
                    }),
                  catch: (error) =>
                    new ToolFailure({ message: error instanceof Error ? error.message : "Delegation failed" }),
                })
                const text = JSON.stringify(result)
                return { output: text, content: text }
              }
              if (!input.taskID) return yield* new ToolFailure({ message: "Provide taskID" })
              if (input.action === "cancel")
                yield* permission
                  .assert({
                    action: "external_delegate",
                    resources: ["cancel"],
                    save: ["cancel"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.messageID, id: context.id },
                  })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: "Cancellation denied", error })))
              const result = yield* Effect.tryPromise({
                try: async () =>
                  input.action === "status"
                    ? adapter.status(context.sessionID, input.taskID!)
                    : adapter.cancel(context.sessionID, input.taskID!),
                catch: (error) =>
                  new ToolFailure({ message: error instanceof Error ? error.message : "Delegation request failed" }),
              })
              const text = JSON.stringify(result)
              return { output: text, content: text }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
