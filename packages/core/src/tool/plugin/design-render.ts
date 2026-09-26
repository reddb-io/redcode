export * as DesignRenderTool from "./design-render.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Design } from "@opencode/schema/design"
import { Effect, Schema } from "effect"
import { DesignQuality } from "../../design/quality.js"
import { DesignRounds } from "../../design/rounds.js"
import { DesignRenderer } from "../../design/renderer.js"
import { DesignStore } from "../../design/store.js"
import { Permission } from "../../permission.js"

export const Plugin = {
  id: "redcode.tool.design-render",
  effect: Effect.fn("DesignRenderTool.Plugin")(function* (ctx: Context) {
    const designs = yield* DesignStore.Service
    const renderer = yield* DesignRenderer.Service
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "design_export",
          options: { codemode: false },
          description:
            "Start a local HTML or PDF export, rendered audit, implementation comparison, SVG to GIF export, or feedback round verification. Poll design_jobs for the result and evidence.",
          input: Schema.Struct({ id: Design.ID, input: Design.Render }),
          output: Design.Job,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "design_export",
                resources: [input.id],
                save: [input.id],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              yield* designs.get(context.sessionID, input.id)
              const output = yield* renderer.start(context.sessionID, input.id, input.input)
              return {
                output,
                content: `Job ${output.id}: ${output.status}. Use design_jobs to read progress.`,
                metadata: { designID: input.id, jobID: output.id },
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })
        editor.add({
          name: "design_jobs",
          options: { codemode: false },
          description:
            "Read export and audit progress or cancel one job. Interrupted jobs require an explicit new request.",
          input: Schema.Struct({ id: Design.ID, cancel: Schema.optional(Schema.String) }),
          output: Schema.Struct({
            jobs: Schema.Array(Design.Job),
            revision: Schema.NullOr(Schema.String),
            notes: Schema.Array(Design.Note),
          }),
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "design_jobs",
                resources: [input.id],
                save: [input.id],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const document = yield* designs.get(context.sessionID, input.id)
              const jobs = input.cancel
                ? [yield* renderer.cancel(context.sessionID, input.id, input.cancel)]
                : yield* renderer.jobs(context.sessionID, input.id)
              const output = { jobs, revision: document.revision, notes: document.notes ?? [] }
              return {
                output,
                content: DesignQuality.report(output.jobs, output.revision, output.notes),
                metadata: {
                  designID: input.id,
                  cancel: input.cancel,
                  verified: jobs.flatMap((job) =>
                    job.status === "completed" && job.verify
                      ? [{
                          design: job.designID,
                          revision: job.verify.revision,
                          round: job.verify.round,
                          job: job.id,
                          notes: job.verify.notes.map((note) => ({
                            feedback: note.feedback,
                            index: note.index,
                            label: note.label,
                            verdict: DesignRounds.verdict(note),
                            reason: note.reason,
                          })),
                        }]
                      : [],
                  ),
                },
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })
      })
      .pipe(Effect.orDie)
  }),
}
