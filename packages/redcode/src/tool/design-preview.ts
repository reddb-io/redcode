import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./design-preview.txt"
import { DesignRegistry } from "@/design/registry"
import { DesignServe } from "@/design/serve"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { InstanceState } from "@/effect/instance-state"

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "Directory holding the prototype. Must contain index.html.",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "What to call this prototype in the review window. Defaults to the directory name.",
  }),
})

export const DesignPreviewTool = Tool.define(
  "design_preview",
  Effect.gen(function* () {
    const registry = yield* DesignRegistry.Service
    const fs = yield* FSUtil.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: typeof Parameters.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const root = path.resolve(instance.worktree, params.path)
          const entry = path.join(root, "index.html")
          if (!(yield* fs.existsSafe(entry))) {
            throw new Error(`No index.html in ${path.relative(instance.worktree, root) || "."}. Write the prototype first.`)
          }

          const prototype = yield* registry.register({
            sessionID: ctx.sessionID,
            root,
            name: params.name?.trim() || path.basename(root),
          })

          const { Server } = yield* Effect.promise(() => import("../server/server"))
          const base = Server.url?.toString().replace(/\/$/, "") ?? "http://localhost:4096"
          const url = `${base}/design/${prototype.id}`

          // Opened for the person, not for us: if the browser refuses, the URL in the output is
          // still the whole answer, so a failure here must not fail the tool.
          yield* Effect.promise(async () => {
            const { default: open } = await import("open")
            await open(url).catch(() => undefined)
          }).pipe(Effect.ignore)

          const served = DesignServe.mimeFor(entry) ? "index.html" : "nothing servable"
          return {
            title: prototype.name,
            metadata: { url, revision: prototype.revision, entry: served },
            output: [
              `Prototype "${prototype.name}" is open at ${url} (revision ${prototype.revision}).`,
              `The user annotates elements there; their notes arrive here as a <design-feedback> block.`,
              `Call design_preview again after each revision.`,
            ].join("\n"),
          }
        }),
    }
  }),
)

export * as DesignPreview from "./design-preview"
