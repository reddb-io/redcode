export * as DesignRenderTool from "./design-render.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Design } from "@opencode/schema/design"
import { Effect, Schema } from "effect"
import { DesignQuality } from "../../design/quality.js"
import { DesignRounds } from "../../design/rounds.js"
import { DesignRenderer } from "../../design/renderer.js"
import { DesignStore } from "../../design/store.js"
import { MonitorRuntime } from "../../monitor.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"

export const Plugin = {
  id: "redcode.tool.design-render",
  effect: Effect.fn("DesignRenderTool.Plugin")(function* (ctx: Context) {
    const designs = yield* DesignStore.Service
    const renderer = yield* DesignRenderer.Service
    const permission = yield* Permission.Service
    const monitors = yield* MonitorRuntime.Service
    const sessions = yield* Session.Service
    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "design_export",
          options: { codemode: false },
          description:
            "Start a local HTML or PDF export, rendered audit, implementation comparison, SVG to GIF export, or feedback round verification. A native monitor waits for completion and resumes this Session with the result and evidence; do not repeatedly poll design_jobs.",
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
              const document = yield* designs.get(context.sessionID, input.id)
              const output = yield* renderer.start(context.sessionID, input.id, input.input)
              const reviewing = input.input.format === "audit" || input.input.format === "verify"
              if (output.status !== "queued" && output.status !== "running")
                return {
                  output,
                  content: DesignQuality.report([output], document.revision, document.notes ?? []),
                  metadata: { designID: input.id, jobID: output.id, jobStatus: output.status },
                }
              const messages = yield* sessions.context(context.sessionID)
              const recentInput = messages.findLast(
                (message) => message.type === "user" || message.type === "synthetic",
              )
              const monitor = yield* monitors.start({
                sessionID: context.sessionID,
                originMessageID: messages.findLast((message) => message.type === "user")?.id,
                autonomous: recentInput?.type === "synthetic",
                command: `${reviewing ? "Applying anti-slop" : "Design"} ${input.input.format}: ${output.id} revision=${input.input.revision}`,
                workdir: document.root,
                options: {
                  mode: "poll",
                  wait_ms: 1000,
                  interval_ms: 2000,
                  // Verification allows up to 30 minutes; leave time for its terminal record.
                  deadline_ms: 1860000,
                  success_contains: `[${output.id}:completed]`,
                  failure_contains: `[${output.id}:failed]`,
                },
                run: () =>
                  Effect.gen(function* () {
                    const jobs = yield* renderer.jobs(context.sessionID, input.id)
                    const job = jobs.find((item) => item.id === output.id)
                    if (!job)
                      return {
                        exit: 0,
                        truncated: false,
                        output: `[${output.id}:failed]\nDesign job not found; inspect it before retrying.`,
                      }
                    const current = yield* designs.get(context.sessionID, input.id)
                    const status =
                      job.status === "queued" || job.status === "running"
                        ? "pending"
                        : job.status === "completed"
                          ? "completed"
                          : "failed"
                    return {
                      exit: 0,
                      truncated: false,
                      output: `[${output.id}:${status}]\n${DesignQuality.report([job], job.input.revision, current.notes ?? [])}${current.revision !== job.input.revision ? `\nThis job verified an older revision; current revision is ${current.revision}.` : ""}${status === "completed" ? "\nRead design_jobs once for the completed tool evidence, inspect the captures and update the corresponding Design tasks and note outcomes before replying." : ""}`,
                    }
                  }),
              })
              return {
                output,
                content:
                  monitor.status === "running"
                    ? `${reviewing ? "Applying anti-slop. " : ""}Job ${output.id}: ${output.status}. Monitor ${monitor.id} is waiting for completion and will resume this Session with the rendered evidence. Do not poll design_jobs or promise future verification; wait for the monitor result before recording note outcomes.`
                    : (monitor.evidence?.output ?? `Job ${output.id}: monitor ${monitor.status}.`),
                metadata: { designID: input.id, jobID: output.id, jobStatus: output.status, monitorID: monitor.id },
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
                  verifiedCurrent:
                    !input.cancel &&
                    jobs.some((job) => job.status === "completed" && job.input.revision === document.revision),
                  verified: jobs.flatMap((job) =>
                    job.status === "completed" && job.verify
                      ? [
                          {
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
                          },
                        ]
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
