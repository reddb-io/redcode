export * as DesignAssetTool from "./design-asset.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Design } from "@opencode/schema/design"
import { Effect, Schema } from "effect"
import { DesignStore } from "../../design/store.js"
import { DesignCollaboration } from "../../design/collaboration.js"
import { Permission } from "../../permission.js"

export const name = "design_asset"
export const Input = Schema.Struct({ id: Design.ID, input: Design.ImportAsset })

export const Plugin = {
  id: "redcode.tool.design-asset",
  effect: Effect.fn("DesignAssetTool.Plugin")(function* (ctx: Context) {
    const designs = yield* DesignStore.Service
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Import an image or editable SVG returned by a connected tool. Keep the original, source and parent version; use the returned asset filename in the prototype.",
          input: Input,
          output: Design.Asset,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.id],
                save: [input.id],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const document = yield* designs.get(context.sessionID, input.id)
              const assigned = DesignCollaboration.author(document, context.agent)
              if (assigned) return yield* new Design.Error({ code: "conflict", message: assigned })
              const output = yield* designs.importAsset(context.sessionID, input.id, input.input)
              return {
                output,
                content: `Asset ${output.id}: assets/${output.id}-${output.name} (${output.mime}). Source: ${output.source}`,
                metadata: { designID: input.id, assetID: output.id },
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
