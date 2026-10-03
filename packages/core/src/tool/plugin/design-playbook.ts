export * as DesignPlaybookTool from "./design-playbook.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Design } from "@opencode/schema/design"
import { Effect, Schema } from "effect"
import { DesignChecklist } from "../../design/checklist.js"
import { DesignPlaybooks } from "../../design/playbooks.js"
import { DesignStore } from "../../design/store.js"
import { Permission } from "../../permission.js"

export const Plugin = {
  id: "redcode.tool.design-playbook",
  effect: Effect.fn("DesignPlaybookTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    const designs = yield* DesignStore.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: "design_playbook",
          options: { codemode: false },
          description:
            "Read artifact guidance. At the end of a Design round, use checklist=true and designID to review the recorded brief, direction and design system without starting another development cycle. Optional id selects component, screen, flow or slides.",
          input: Schema.Struct({
            id: Schema.optional(Schema.String),
            designID: Schema.optional(Design.ID),
            checklist: Schema.optional(Schema.Boolean),
          }),
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "design_playbook",
                resources: [input.designID ?? "*"],
                save: [input.designID ?? "*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const playbook = input.id ? DesignPlaybooks.find(input.id) : undefined
              if (input.id && !playbook)
                return yield* new ToolFailure({
                  message: `Unknown Design playbook: ${input.id}. ${DesignPlaybooks.list()}`,
                })
              if (input.checklist && !input.designID)
                return yield* new ToolFailure({ message: "An end-of-round checklist requires designID." })
              const document = input.designID ? yield* designs.get(context.sessionID, input.designID) : undefined
              const selected =
                playbook?.id === "component" ||
                playbook?.id === "screen" ||
                playbook?.id === "flow" ||
                playbook?.id === "slides"
                  ? playbook.id
                  : undefined
              const checklist = document ? DesignChecklist.render(document, selected) : ""
              const output = input.checklist
                ? checklist
                : [playbook ? DesignPlaybooks.render(playbook) : DesignPlaybooks.list(), checklist]
                    .filter(Boolean)
                    .join("\n\n")
              return {
                output,
                content: output,
                metadata: { playbook: playbook?.id, designID: input.designID, checklist: input.checklist },
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
