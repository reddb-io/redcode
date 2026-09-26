export * as DesignDetectTool from "./design-detect.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { DesignDetection } from "../../design/detection.js"
import { Permission } from "../../permission.js"

export const name = "design_detect"
export const Input = Schema.Struct({
  application: Schema.String.pipe(Schema.optionalKey),
  pack: Schema.Boolean.pipe(Schema.optionalKey),
})

export const Plugin = {
  id: "redcode.tool.design-detect",
  effect: Effect.fn("DesignDetectTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Inspect the application's design system using a bounded static file scan. Returns a proposed system and the source evidence; changes no files or configuration.",
          input: Input,
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.application ?? "*"],
                save: [input.application ?? "*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const output = yield* DesignDetection.report({ ...input, pack: input.pack ?? true })
              return { output, content: output, metadata: { application: input.application } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
