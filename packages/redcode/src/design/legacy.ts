export * as DesignLegacy from "./legacy"

import path from "node:path"
import { Effect, Schema, Option } from "effect"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignFiles } from "@reddb-io/redcode-core/design/files"
import { DesignApp } from "@reddb-io/redcode-core/design/app"
import { Design } from "@reddb-io/redcode-schema/design"
import { InstanceState } from "@/effect/instance-state"
import { DesignRead } from "./read"
import type { Tool } from "@/tool/tool"

/** The assets a pre-0.22 prototype could reference from `../../vendor/` or `/design/vendor/`. */
const VENDOR = ["tailwind.js", "daisyui.css", "daisyui-themes.css", "mermaid.js"]

/**
 * Reopen a pre-0.22 prototype as a new revision, preserving its source and private review files. The
 * vendor assets it references are copied in from the design app, or from source when Design runs inline.
 */
export const importPrototype = Effect.fn("DesignLegacy.importPrototype")(function* (
  input: { path: string; name?: string; reopen?: boolean },
  ctx: Tool.Context,
  app: DesignApp.Connection | undefined,
) {
  const store = yield* DesignStore.Service
  const instance = yield* InstanceState.context
  const root = path.resolve(instance.directory, input.path)
  const read = yield* DesignRead.make(ctx.ask)
  yield* Effect.promise(() => read(path.join(root, "index.html"), ctx.abort))
  yield* ctx.ask({ permission: "design_edit", patterns: ["*"], always: ["*"], metadata: { source: root } })
  const reference = `Imported prototype: ${root}`
  const existing = (yield* store.list(ctx.sessionID)).find((document) => document.brief.references.includes(reference))
  const document =
    existing ??
    (yield* store.create(ctx.sessionID, {
      name: input.name ?? path.basename(root),
      journey: "new",
      engine: "html",
      kind: "screen",
    }))
  if (document.ended && !input.reopen) return document
  if (document.ended) yield* store.reopen(document.id)
  const files = yield* Effect.promise(() => DesignFiles.snapshot(root, store.blobs, read))
  yield* Effect.promise(() => DesignFiles.restore(document.root, store.blobs, files))
  const entry = path.join(document.root, "index.html")
  const html = yield* Effect.promise(() => Bun.file(entry).text())
  const rewritten = html.replace(
    /(["'])(?:\.\.\/\.\.\/vendor\/|\/design\/vendor\/)([^"']+)\1/g,
    (match, quote, name: string) => (VENDOR.includes(name) ? `${quote}vendor/${name}${quote}` : match),
  )
  if (rewritten !== html) {
    yield* Effect.forEach(
      VENDOR.filter((name) => rewritten.includes(`vendor/${name}`)),
      (name) =>
        vendor(app, name).pipe(
          Effect.flatMap((body) =>
            Effect.promise(() => DesignFiles.atomic(path.join(document.root, "vendor", name), body)),
          ),
        ),
    )
    yield* Effect.promise(() => DesignFiles.atomic(entry, rewritten))
  }
  const manifest = yield* Effect.promise(async () =>
    (await Bun.file(path.join(document.root, "design.json")).exists())
      ? Schema.decodeUnknownOption(
          Schema.fromJsonString(
            Schema.Struct({
              version: Schema.Literal(1),
              decisions: Schema.optional(Schema.Array(Schema.String)),
              questions: Schema.optional(Schema.Array(Schema.String)),
            }),
          ),
        )(await Bun.file(path.join(document.root, "design.json")).text())
      : Option.none(),
  )
  const decisions = Option.isSome(manifest) ? (manifest.value.decisions ?? []) : []
  const questions = Option.isSome(manifest) ? (manifest.value.questions ?? []) : []
  return yield* store.update(document.id, {
    brief: { ...document.brief, references: [...new Set([...document.brief.references, reference])] },
    decisions: [
      ...document.decisions,
      ...decisions
        .filter((text) => !document.decisions.some((decision) => decision.text === text))
        .map((text) => ({ id: `legacy_${DesignFiles.hash(new TextEncoder().encode(text)).slice(0, 16)}`, text })),
    ],
    questions: [...new Set([...document.questions, ...questions])],
  })
})

function vendor(app: DesignApp.Connection | undefined, name: string): Effect.Effect<string, Design.Error> {
  if (app) return DesignApp.vendor(app, name)
  // Compiled redcode defines REDCODE_DESIGN_APP_ONLY, so its bundler drops these megabytes of assets.
  return process.env.REDCODE_DESIGN_APP_ONLY === "1"
    ? Effect.fail(new Design.Error({ code: "unavailable", message: "The design app serves the legacy vendor assets" }))
    : Effect.promise(async () => {
        const { DesignVendor } = await import("@reddb-io/redcode-design/vendor")
        return DesignVendor.FILES[name].body
      })
}
