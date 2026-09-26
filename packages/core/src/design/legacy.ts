export * as DesignLegacy from "./legacy.js"

import path from "node:path"
import { Effect, Option, Schema } from "effect"
import { Design } from "@opencode/schema/design"
import { DesignFiles } from "./files.js"
import { DesignStore } from "./store.js"

const VENDOR = ["tailwind.js", "daisyui.css", "daisyui-themes.css", "mermaid.js"]
const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  decisions: Schema.optional(Schema.Array(Schema.String)),
  questions: Schema.optional(Schema.Array(Schema.String)),
})

/** Reopen a pre-0.22 prototype as a new Design revision without losing its source files. */
export const importPrototype = Effect.fn("DesignLegacy.importPrototype")(function* (input: {
  readonly sessionID: Design.Info["sessionID"]
  readonly directory: string
  readonly path: string
  readonly name?: string
  readonly reopen?: boolean
  readonly read: (file: string) => Promise<void>
  readonly vendor: (name: string) => Promise<string>
}) {
  const store = yield* DesignStore.Service
  const root = path.resolve(input.directory, input.path)
  yield* Effect.promise(() => input.read(path.join(root, "index.html")))
  const reference = `Imported prototype: ${root}`
  const existing = (yield* store.list(input.sessionID)).find((document) => document.brief.references.includes(reference))
  const document = existing ?? (yield* store.create(input.sessionID, {
    name: input.name ?? path.basename(root),
    journey: "new",
    engine: "html",
    kind: "screen",
  }))
  if (document.ended && !input.reopen) return document
  if (document.ended) yield* store.reopen(input.sessionID, document.id)
  const files = yield* Effect.promise(() => DesignFiles.snapshot(root, store.blobs, input.read))
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
        Effect.promise(() => input.vendor(name)).pipe(
          Effect.flatMap((body) => Effect.promise(() => DesignFiles.atomic(path.join(document.root, "vendor", name), body))),
        ),
      { discard: true },
    )
    yield* Effect.promise(() => DesignFiles.atomic(entry, rewritten))
  }
  const manifest = yield* Effect.promise(async () =>
    (await Bun.file(path.join(document.root, "design.json")).exists())
      ? Schema.decodeUnknownOption(Schema.fromJsonString(Manifest))(
          await Bun.file(path.join(document.root, "design.json")).text(),
        )
      : Option.none(),
  )
  const decisions = Option.isSome(manifest) ? (manifest.value.decisions ?? []) : []
  const questions = Option.isSome(manifest) ? (manifest.value.questions ?? []) : []
  return yield* store.update(input.sessionID, document.id, {
    brief: { ...document.brief, references: [...new Set([...document.brief.references, reference])] },
    decisions: [
      ...document.decisions,
      ...decisions
        .filter((text) => !document.decisions.some((decision) => decision.text === text))
        .map((text) => ({ id: `legacy_${DesignFiles.hash(text).slice(0, 16)}`, text })),
    ],
    questions: [...new Set([...document.questions, ...questions])],
  })
})
