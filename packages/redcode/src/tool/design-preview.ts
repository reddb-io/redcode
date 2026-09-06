import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./design-preview.txt"
import { DesignRegistry } from "@/design/registry"
import { DesignServe } from "@/design/serve"
import { DesignLint } from "@/design/lint"
import { DesignStates } from "@/design/states"
import { DesignKinds } from "@/design/kinds"
import { DesignManifest } from "@/design/manifest"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { InstanceState } from "@/effect/instance-state"

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "Directory holding the prototype. Must contain index.html.",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "What to call this prototype in the review window. Defaults to the directory name.",
  }),
  reopen: Schema.optional(Schema.Boolean).annotate({
    description:
      "Open a review the person ended. Without it, a prototype the user closed stays closed and the tool says so.",
  }),
})

/** What the tool part records, whichever way the call went. */
interface Meta {
  id: string
  url: string
  revision: number
  entry: string
  kind: DesignKinds.Kind
  findings: string[]
  missingStates: DesignStates.State[]
  status: "open" | "user-ended"
}

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
          // Against the directory the agent works in, not the worktree: with no repository the worktree is "/".
          const root = path.resolve(instance.directory, params.path)
          const entry = path.join(root, "index.html")
          if (!(yield* fs.existsSafe(entry))) {
            throw new Error(
              `No index.html in ${path.relative(instance.directory, root) || "."}. Write the prototype first.`,
            )
          }

          // A review the person ended stays ended: they closed it, and the agent does not reopen it
          // on its own. An explicit `reopen` is the agent relaying that the person asked.
          const before = yield* registry.get(DesignRegistry.idFor(ctx.sessionID, root))
          if (before?.ended?.by === "user" && !params.reopen) {
            const metadata: Meta = {
              id: before.id,
              url: "",
              revision: before.revision,
              entry: "index.html",
              kind: "screen",
              findings: [],
              missingStates: [],
              status: "user-ended",
            }
            return {
              title: params.name?.trim() || path.basename(root),
              metadata,
              output: [
                `The user ended the review of "${before.name}". It was not reopened.`,
                "Finish from the notes you have, or call design_preview again with reopen: true if the user asks to look again.",
              ].join("\n"),
            }
          }
          if (before?.ended && params.reopen) yield* registry.reopen(before.id)

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
          // Tests set REDCODE_DESIGN_NO_OPEN so a suite never pops a browser on someone's desk.
          if (!process.env["REDCODE_DESIGN_NO_OPEN"]) {
            yield* Effect.promise(async () => {
              const { default: open } = await import("open")
              await open(url).catch(() => undefined)
            }).pipe(Effect.ignore)
          }

          const served = DesignServe.mimeFor(entry) ? "index.html" : "nothing servable"
          const html = yield* Effect.promise(() => Bun.file(entry).text())

          // The manifest says what kind of thing this is; a missing manifest means a screen.
          const manifestFile = DesignManifest.file(root)
          const manifest = (yield* fs.existsSafe(manifestFile))
            ? DesignManifest.parse(yield* Effect.promise(() => Bun.file(manifestFile).text()), prototype.name)
            : DesignManifest.empty(prototype.name)

          // Craft notes ride along with the URL: the model is reading this anyway, and nobody
          // else needs to be woken for them. Same for the kind's own checks.
          const findings = [
            ...DesignLint.lint(html),
            ...DesignKinds.check(manifest.kind, html),
            // Render-free, and fail-open: a page that never paints its own surface can have invisible text.
            ...(DesignLint.analyzeSelfPaint(html).painted ? [] : [DesignLint.SELF_PAINT]),
          ]
          const notes = DesignLint.report(findings)

          // A missing state is a question the plan must carry, so it goes into design.json now
          // rather than relying on the model to remember it later.
          const coverage = DesignStates.states(html)
          const questions = DesignStates.syncQuestions(manifest.questions, coverage)
          const changed = questions.join("\n") !== manifest.questions.join("\n")
          if (changed || !(yield* fs.existsSafe(manifestFile))) {
            yield* Effect.promise(() => Bun.write(manifestFile, DesignManifest.serialize({ ...manifest, questions })))
          }
          const states = DesignStates.report(coverage)

          // Five minutes, not two: a background tab's timer runs once a minute at best, and the
          // app's tab polls as well, so anything shorter would cry wolf.
          const STALE_MS = 5 * 60_000
          const lastSeen = prototype.lastSeen
          const stale =
            lastSeen !== undefined && Date.now() - lastSeen > STALE_MS
              ? `The review window has not checked in for ${Math.round((Date.now() - lastSeen) / 60_000)} minutes; the user may not be looking at it. Say so if you are waiting on them.`
              : undefined

          const metadata: Meta = {
            id: prototype.id,
            url,
            revision: prototype.revision,
            entry: served,
            kind: manifest.kind,
            findings: findings.map((f) => f.id),
            missingStates: [...coverage.missing],
            status: "open",
          }
          return {
            title: prototype.name,
            metadata,
            output: [
              `Prototype "${prototype.name}" (${manifest.kind}) is open at ${url} (revision ${prototype.revision}).`,
              `The user annotates elements there; their notes arrive here as a <design-feedback> block.`,
              `Call design_preview again after each revision.`,
              ...(stale ? ["", stale] : []),
              ...(states ? ["", states] : []),
              ...(notes ? ["", notes] : []),
            ].join("\n"),
          }
        }),
    }
  }),
)

export * as DesignPreview from "./design-preview"
