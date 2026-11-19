export * as DesignAssetTool from "./design-asset.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Design } from "@opencode/schema/design"
import { Effect, Schema } from "effect"
import { DesignAssets } from "../../design/assets.js"
import { DesignStore } from "../../design/store.js"
import { DesignCollaboration } from "../../design/collaboration.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionMessage } from "../../session/message.js"

export const name = "design_asset"
/** An image the user attached to a message, by the reference its "Attached image" label shows. */
export const AttachedImage = Schema.Struct({
  attachment: Schema.String.check(Schema.isPattern(/^msg_[^/\s]+\/[1-9]\d*$/)),
  name: Schema.NonEmptyString.pipe(Schema.optional),
})
export const Input = Schema.Struct({ id: Design.ID, input: Schema.Union([Design.ImportAsset, AttachedImage]) })
const importable = Schema.is(Design.ImportAsset.fields.mime)

export const Plugin = {
  id: "redcode.tool.design-asset",
  effect: Effect.fn("DesignAssetTool.Plugin")(function* (ctx: Context) {
    const designs = yield* DesignStore.Service
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    // The bytes of an image the user pasted, which the agent sees but cannot pass to the tool itself.
    const attached = Effect.fn("DesignAssetTool.attached")(function* (
      sessionID: Parameters<typeof sessions.message>[0]["sessionID"],
      input: typeof AttachedImage.Type,
    ) {
      const [messageID = "", position = ""] = input.attachment.split("/")
      const missing = new Design.Error({
        code: "not-found",
        message: `${input.attachment} is not an image the user attached to this session; use the reference an "Attached image" label shows.`,
      })
      const message = yield* sessions
        .message({ sessionID, messageID: SessionMessage.ID.make(messageID) })
        .pipe(Effect.catch(() => Effect.fail(missing)))
      const file = message?.type === "user" ? message.files?.[Number(position) - 1] : undefined
      if (!file || !importable(file.mime)) return yield* missing
      return {
        name:
          input.name ?? file.name ?? `attachment-${position}.${file.mime.split("/")[1]?.replace("+xml", "") ?? "png"}`,
        mime: file.mime,
        data: file.data,
        source: `user attachment ${input.attachment}`,
      }
    })
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            'Import an image or editable SVG into the design: one returned by a connected tool, or one the user attached, passed as {attachment:"msg_…/n"} with the reference its "Attached image" label shows. Keep the original, source and parent version; use the returned asset filename in the prototype.',
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
              const asset = "attachment" in input.input ? yield* attached(context.sessionID, input.input) : input.input
              const output = yield* designs.importAsset(context.sessionID, input.id, asset)
              return {
                output,
                content: `Asset ${output.id}: ${DesignAssets.path(output)} (${output.mime}). Source: ${output.source}`,
                metadata: { designID: input.id, assetID: output.id },
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
