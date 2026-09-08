export * as DesignLegacy from "./legacy"

import path from "node:path"
import { Effect, Schema, Option } from "effect"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignFiles } from "@reddb-io/redcode-core/design/files"
import { InstanceState } from "@/effect/instance-state"
import { DesignRead } from "./read"
import type { Tool } from "@/tool/tool"

/** Reopen a pre-0.22 prototype as a new revision, preserving its source and private review files. */
export const importPrototype = Effect.fn("DesignLegacy.importPrototype")(function* (
  input: { path: string; name?: string; reopen?: boolean },
  ctx: Tool.Context,
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
  yield* Effect.promise(async () => {
    const { DesignVendor } = await import("./vendor")
    const entry = path.join(document.root, "index.html")
    const html = await Bun.file(entry).text()
    const rewritten = html.replace(
      /(["'])(?:\.\.\/\.\.\/vendor\/|\/design\/vendor\/)([^"']+)\1/g,
      (match, quote, name: string) => (DesignVendor.FILES[name] ? `${quote}vendor/${name}${quote}` : match),
    )
    if (rewritten !== html) {
      for (const [name, asset] of Object.entries(DesignVendor.FILES))
        if (rewritten.includes(`vendor/${name}`))
          await DesignFiles.atomic(path.join(document.root, "vendor", name), asset.body)
      await DesignFiles.atomic(entry, rewritten)
    }
  })
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
