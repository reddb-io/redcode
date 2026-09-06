import path from "path"
import { promises as nodeFs } from "node:fs"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./design-export.txt"
import { DesignExport } from "@/design/export"
import { DesignRegistry } from "@/design/registry"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { InstanceState } from "@/effect/instance-state"

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "Directory holding the prototype. Must contain index.html.",
  }),
  out: Schema.optional(Schema.String).annotate({
    description:
      "Where to write the file. Defaults to <path>/.review/<name>.export.html, beside the review's own state, so the design directory stays what the user designed.",
  }),
})

interface Meta {
  file: string
  bytes: number
  unresolved: string[]
  notices: string[]
}

/**
 * The same bundle the review page's "Export" produces, written to disk by the agent when the
 * user asks for a file. Nothing is fetched and nothing outside the prototype directory is read.
 */
export const DesignExportTool = Tool.define(
  "design_export",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const registry = yield* DesignRegistry.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: typeof Parameters.Type) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const root = path.resolve(instance.directory, params.path)
          const entry = path.join(root, "index.html")
          if (!(yield* fs.existsSafe(entry))) {
            throw new Error(`No index.html in ${path.relative(instance.directory, root) || "."}. Nothing to export.`)
          }
          const name = path.basename(root)
          const out = params.out ? path.resolve(instance.directory, params.out) : DesignExport.defaultOut(root, name)
          const caps = yield* registry.exportCaps()
          const html = yield* Effect.promise(() => Bun.file(entry).text())
          const result = yield* Effect.promise(() => DesignExport.build(root, html, caps))
          yield* Effect.promise(() => nodeFs.mkdir(path.dirname(out), { recursive: true }))
          const bytes = yield* Effect.promise(() => Bun.write(out, result.html))
          const metadata: Meta = {
            file: out,
            bytes,
            unresolved: result.unresolved.map((w) => `${w.kind}: ${w.ref}`),
            notices: result.notices.map((w) => `${w.kind}: ${w.ref}`),
          }
          return {
            title: path.basename(out),
            metadata,
            output: [
              `Wrote ${out} (${bytes} bytes). ${DesignExport.summary(result.unresolved.length, result.notices.length)}`,
              ...(result.unresolved.length
                ? ["", "Not inlined — the file needs these beside it, or the reference should change:", ...DesignExport.describe(result.unresolved)]
                : []),
              ...(result.notices.length ? ["", "Notices:", ...DesignExport.describe(result.notices)] : []),
            ].join("\n"),
          }
        }),
    }
  }),
)

export * as DesignExportToolModule from "./design-export"
