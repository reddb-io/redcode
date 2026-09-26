export * as DesignPlaybookTool from "./design-playbook.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { DesignPlaybooks } from "../../design/playbooks.js"
import { Permission } from "../../permission.js"

export const Plugin = {
  id: "redcode.tool.design-playbook",
  effect: Effect.fn("DesignPlaybookTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: "design_playbook",
          options: { codemode: false },
          description: "Read guidance for screens, flows, comparisons and presentations before creating a prototype.",
          input: Schema.Struct({ id: Schema.optional(Schema.String) }),
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "design_playbook",
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const playbook = input.id ? DesignPlaybooks.find(input.id) : undefined
              if (input.id && !playbook)
                return yield* new ToolFailure({
                  message: `Unknown Design playbook: ${input.id}. ${DesignPlaybooks.list()}`,
                })
              const output = playbook ? DesignPlaybooks.render(playbook) : DesignPlaybooks.list()
              return { output, content: output, metadata: { playbook: playbook?.id } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
