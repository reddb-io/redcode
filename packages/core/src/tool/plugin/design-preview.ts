export * as DesignPreviewTool from "./design-preview.js"

import path from "node:path"
import { stat } from "node:fs/promises"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Design } from "@opencode/schema/design"
import { Cause, Effect, Schema } from "effect"
import { DesignBuild } from "../../design/build.js"
import { DesignAppConnection } from "../../design/app-connection.js"
import { DesignAppMode } from "../../design/app-mode.js"
import { DesignLegacy } from "../../design/legacy.js"
import { DesignQuality } from "../../design/quality.js"
import { DesignStore } from "../../design/store.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { Location } from "../../location.js"
import type { Tool } from "../../tool.js"

export const name = "design_preview"
export const Input = Schema.Struct({
  id: Schema.optional(Design.ID),
  name: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  reopen: Schema.optional(Schema.Boolean),
}).pipe(
  Schema.decodeTo(
    Schema.Union([
      Schema.Struct({ id: Design.ID, name: Schema.String }),
      Schema.Struct({ path: Schema.String, name: Schema.optional(Schema.String), reopen: Schema.optional(Schema.Boolean) }),
    ]),
  ),
)

export const Plugin = {
  id: "redcode.tool.design-preview",
  effect: Effect.fn("DesignPreviewTool.Plugin")(function* (ctx: Context) {
    const designs = yield* DesignStore.Service
    const apps = yield* DesignAppConnection.Service
    const access = yield* FileAccess.Service
    const permission = yield* Permission.Service
    const location = yield* Location.Service

    const source = (context: Tool.Context) => ({ type: "tool" as const, messageID: context.messageID, id: context.id })
    const read = (context: Tool.Context): DesignBuild.Read => (file, signal) =>
      Effect.runPromise(access.authorizeRead(file, context), { signal }).then(() => undefined)

    const standing = Effect.fn("DesignPreviewTool.standing")(function* (
      document: Design.Info,
      context: Tool.Context,
    ) {
      const files = yield* Effect.promise(() => DesignBuild.grant(document))
      if (!files.length) return
      const targets = yield* Effect.forEach(files, (file) =>
        Effect.all({
          target: access.resolve({ path: file, kind: "directory" }),
          directory: Effect.promise(() => stat(file).then((info) => info.isDirectory())),
        }),
      )
      const metadata = {
        origin: "design.system",
        reason:
          "Standing read grant for Design builds: declared roots, stylesheets, tooling configuration and project modules.",
      }
      yield* access.authorizeExternal(
        targets.map((item) => item.target),
        context,
        metadata,
      )
      const resources = targets.map((item) =>
        item.directory ? `${item.target.resource}/*` : item.target.resource,
      )
      yield* permission.assert({
        action: "read",
        resources,
        save: resources,
        sessionID: context.sessionID,
        agent: context.agent,
        source: source(context),
        metadata,
      })
    })

    const tooling = Effect.fn("DesignPreviewTool.tooling")(function* (
      document: Design.Info,
      context: Tool.Context,
    ) {
      const files = yield* Effect.promise(() => DesignBuild.tooling(document))
      if (!files.length) return false
      const resources = yield* Effect.forEach(files, (file) =>
        Effect.all({
          target: access.resolve({ path: file, kind: "directory" }),
          directory: Effect.promise(() => stat(file).then((info) => info.isDirectory())),
        }).pipe(Effect.map((item) => (item.directory ? `${item.target.resource}/*` : item.target.resource))),
      )
      return yield* permission
        .assert({
          action: "project_tooling",
          resources,
          save: resources,
          sessionID: context.sessionID,
          agent: context.agent,
          source: source(context),
          metadata: {
            origin: "design.system",
            reason: `Execute project tooling: ${files.map((file) => path.basename(file)).join(", ")}`,
          },
        })
        .pipe(
          Effect.as(true),
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            if (
              error instanceof Permission.DeclinedError ||
              error instanceof Permission.CorrectedError ||
              error instanceof Permission.BlockedError
            )
              return Effect.succeed(false)
            return Effect.failCause(cause)
          }),
        )
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Publish an immutable, reviewable Design revision after coherent edits. Use id and name for a current Design. For a pre-0.22 prototype, supply path to its directory instead; name and reopen are optional. Reuse the resulting Design ID for later revisions.",
          input: Input,
          output: Schema.Union([Design.Revision, Schema.String]),
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["path" in input ? "*" : input.id],
                save: ["path" in input ? "*" : input.id],
                sessionID: context.sessionID,
                agent: context.agent,
                source: source(context),
              })
              if ("path" in input)
                yield* permission.assert({
                  action: "design_edit",
                  resources: ["*"],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: source(context),
                })
              const configured = yield* designs.configured(context.sessionID)
              const app = "path" in input && DesignAppMode.process(configured)
                ? yield* Effect.tryPromise(() => apps.connect(configured?.app?.version))
                : undefined
              const document = "path" in input
                ? yield* DesignLegacy.importPrototype({
                    sessionID: context.sessionID,
                    directory: location.directory,
                    path: input.path,
                    name: input.name,
                    reopen: input.reopen,
                    read: (file) => Effect.runPromise(access.authorizeRead(file, context)).then(() => undefined),
                    vendor: async (asset) => {
                      if (app) {
                        const { DesignApp } = await import("../../design/app.js")
                        return DesignApp.vendor(app, asset)
                      }
                      const { DesignVendor } = await import("../../design/vendor.js")
                      return DesignVendor.FILES[asset].body
                    },
                  }).pipe(Effect.provideService(DesignStore.Service, designs))
                : yield* designs.get(context.sessionID, input.id)
              if (document.ended) {
                const content = `The user ended this review. Reopen only on an explicit request. Design: ${document.id}`
                return { output: content, content, metadata: { designID: document.id } }
              }
              yield* standing(document, context)
              const revision = yield* designs.publish(
                context.sessionID,
                document.id,
                input.name ?? document.name,
                read(context),
                yield* tooling(document, context),
              )
              const notice = yield* Effect.promise(() =>
                DesignQuality.screenNotice(revision.document.root, revision.document.engine, revision.document.entry),
              )
              const link = DesignAppMode.process(configured)
                ? yield* Effect.tryPromise(async () => {
                    const { DesignApp } = await import("../../design/app.js")
                    return DesignApp.link(app ?? await apps.connect(configured?.app?.version), context.sessionID)
                  }).pipe(Effect.match({
                    onFailure: (error) => `Review link unavailable: ${String(error)}`,
                    onSuccess: (url) => `Review: ${url}`,
                  }))
                : undefined
              return {
                output: revision,
                content: `Published ${revision.id} for ${revision.designID}. The user can annotate this revision. Root: ${revision.document.root}${notice ?? ""}${link ? `\n${link}` : ""}`,
                metadata: { designID: document.id, revision: revision.id },
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
