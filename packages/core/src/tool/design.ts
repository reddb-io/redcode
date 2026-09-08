export * as DesignTools from "./design"

import { DateTime, Effect, Layer, Schema } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { ToolFailure } from "@reddb-io/redcode-llm"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"
import { PermissionV2 } from "../permission"
import { QuestionV2 } from "../question"
import { EventV2 } from "../event"
import { SessionEvent } from "../session/event"
import { SessionMessage } from "../session/message"
import { SessionGoal } from "../session/goal"
import { makeLocationNode } from "../effect/app-node"
import { DesignStore } from "../design/store"
import { DesignRenderer } from "../design/renderer"
import { DesignPlaybooks } from "../design/playbooks"
import { LocationMutation } from "../location-mutation"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const registry = yield* ToolRegistry.Service
    const store = yield* DesignStore.Service
    const renderer = yield* DesignRenderer.Service
    const permissions = yield* PermissionV2.Service
    const questions = yield* QuestionV2.Service
    const events = yield* EventV2.Service
    const goals = yield* SessionGoal.Service
    const mutation = yield* LocationMutation.Service

    const allow = (action: string, context: Tool.Context) =>
      permissions
        .assert({
          action,
          sessionID: context.sessionID,
          agent: context.agent,
          resources: ["*"],
          save: ["*"],
          source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
        })
        .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
    const owned = (id: Design.ID, context: Tool.Context) => store.get(id, context.sessionID)
    const fail = (error: Design.Error) => new ToolFailure({ message: error.message })
    const read = (context: Tool.Context) => (file: string, signal?: AbortSignal) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const target = yield* mutation.resolve({ path: file, kind: "file" })
          const source = { type: "tool" as const, messageID: context.assistantMessageID, callID: context.toolCallID }
          if (target.externalDirectory)
            yield* permissions.assert({
              ...LocationMutation.externalDirectoryPermission(target.externalDirectory),
              sessionID: context.sessionID,
              agent: context.agent,
              source,
            })
          yield* permissions.assert({
            action: "read",
            resources: [target.resource],
            save: [target.resource],
            sessionID: context.sessionID,
            agent: context.agent,
            source,
          })
        }),
        { signal },
      )

    yield* tools
      .register({
        design_playbook: Tool.make({
          description:
            "Read task-specific design guidance for screens, flows, comparisons and presentations before creating a prototype.",
          input: Schema.Struct({ id: Schema.optional(Schema.String) }),
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_playbook", context)
              if (!input.id) return DesignPlaybooks.list()
              const playbook = DesignPlaybooks.find(input.id)
              if (!playbook) return yield* new ToolFailure({ message: "Unknown design playbook" })
              return DesignPlaybooks.render(playbook)
            }),
        }),
        design_media: Tool.make({
          description:
            "List connected tools with explicitly declared image capabilities. Use their advertised argument schemas with design_generate; never infer image support from a tool name.",
          input: Schema.Struct({}),
          output: Schema.String,
          execute: (_input, context) =>
            Effect.gen(function* () {
              yield* allow("design_media", context)
              const available = yield* registry.materialize()
              return (
                available.media
                  .map(
                    (item) =>
                      `${item.name}: ${item.capability.operations.join(", ")}; ${item.capability.formats.join(", ")}; transparency ${item.capability.transparency}`,
                  )
                  .join("\n") ||
                "No image-capable tools are connected. Configure MCP media declarations or install an image plugin."
              )
            }),
        }),
        design_generate: Tool.make({
          description:
            "Execute one connected image tool through the canonical registry and import its image results as local versioned assets. Use the connected tool's exact argument schema. An interrupted call is not retried automatically.",
          input: Schema.Struct({
            id: Design.ID,
            tool: Schema.String,
            arguments: Schema.Unknown,
            operation: Schema.Literals(["generate", "edit", "reference"]),
            parent: Schema.optional(Schema.String),
          }),
          output: Schema.Array(Design.Asset),
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: output.map((asset) => `Asset ${asset.id}: assets/${asset.id}-${asset.name}`).join("\n"),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_generate", context)
              yield* owned(input.id, context)
              const available = yield* registry.materialize()
              const capability = available.media.find((item) => item.name === input.tool)?.capability
              if (!capability?.operations.includes(input.operation))
                return yield* new ToolFailure({ message: "The connected tool does not declare this image operation" })
              const result = yield* available
                .settle({
                  ...context,
                  call: {
                    type: "tool-call",
                    id: `${context.toolCallID}-media`,
                    name: input.tool,
                    input: input.arguments,
                  },
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
              if (result.result.type === "error")
                return yield* new ToolFailure({ message: String(result.result.value) })
              const assets = yield* Effect.forEach(result.output?.content ?? [], (part) =>
                Effect.gen(function* () {
                  if (part.type !== "file" || !part.uri.startsWith("data:image/")) return []
                  const match = /^data:(image\/(?:png|jpeg|webp|svg\+xml|gif));base64,(.+)$/s.exec(part.uri)
                  if (!match) return []
                  const asset = yield* store.importAsset(
                    input.id,
                    yield* Schema.decodeUnknownEffect(Design.ImportAsset)({
                      name: part.name ?? `generated.${match[1].split("/")[1].replace("svg+xml", "svg")}`,
                      mime: match[1],
                      data: match[2],
                      source: input.tool,
                      parent: input.parent,
                    }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message }))),
                  )
                  return [asset]
                }),
              )
              if (!assets.flat().length)
                return yield* new ToolFailure({
                  message: "The tool returned no inline image. Import its local result with design_asset.",
                })
              return assets.flat()
            }).pipe(Effect.catchTag("Design.Error", fail)),
        }),
        design_document: Tool.make({
          description:
            "Create, inspect or update a design. The returned root is the only directory Design may edit. Persist briefing, decisions and exercised scenarios here.",
          input: Schema.Union([
            Schema.Struct({ action: Schema.Literal("list") }),
            Schema.Struct({ action: Schema.Literal("create"), input: Design.Create }),
            Schema.Struct({ action: Schema.Literal("update"), id: Design.ID, input: Design.Update }),
            Schema.Struct({ action: Schema.Literal("reopen"), id: Design.ID }),
            Schema.Struct({ action: Schema.Literal("refresh"), id: Design.ID }),
          ]),
          output: Schema.Array(Design.Info),
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: output
                .map(
                  (document) =>
                    `Design ${document.id}: ${document.name}\nRoot: ${document.root}\nEngine: ${document.engine}\nEntry: ${document.entry}\nCurrent revision: ${document.revision ?? "unpublished"}\n${document.designSystem}\nQuestions: ${document.questions.join("; ")}`,
                )
                .join("\n\n"),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_document", context)
              if (input.action === "list") return yield* store.list(context.sessionID)
              yield* allow("design_edit", context)
              if (input.action === "create") {
                const document = yield* store.create(context.sessionID, input.input)
                if (context.agent !== "design")
                  yield* events.publish(SessionEvent.AgentSwitched, {
                    sessionID: context.sessionID,
                    messageID: SessionMessage.ID.create(),
                    timestamp: yield* DateTime.now,
                    agent: "design",
                  })
                return [document]
              }
              yield* owned(input.id, context)
              if (input.action === "reopen") return [yield* store.reopen(input.id)]
              if (input.action === "refresh") return [yield* store.refresh(input.id)]
              return [yield* store.update(input.id, input.input)]
            }).pipe(Effect.catchTag("Design.Error", fail)),
        }),
        design_preview: Tool.make({
          description:
            "Publish an immutable, reviewable revision after coherent edits. Updates the embedded preview without opening another browser window.",
          input: Schema.Struct({ id: Design.ID, name: Schema.String }),
          output: Design.Revision,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: `Published ${output.id} for ${output.designID}. The user can annotate this revision. Root: ${output.document.root}`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_preview", context)
              yield* owned(input.id, context)
              return yield* store.publish(input.id, input.name, read(context))
            }).pipe(Effect.catchTag("Design.Error", fail)),
        }),
        design_history: Tool.make({
          description:
            "List immutable design alternatives, or restore one as a new revision while retaining the approved baseline.",
          input: Schema.Struct({ id: Design.ID, restore: Schema.optional(Schema.String) }),
          output: Schema.Array(Design.Revision),
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: output
                .map((revision) => `${revision.id}: ${revision.name} (parent ${revision.parent ?? "none"})`)
                .join("\n"),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_history", context)
              yield* owned(input.id, context)
              if (input.restore) return [yield* store.restore(input.id, input.restore, read(context))]
              return yield* store.revisions(input.id)
            }).pipe(Effect.catchTag("Design.Error", fail)),
        }),
        design_asset: Tool.make({
          description:
            "Import an image or editable SVG returned by a connected tool. Keeps the original, source tool and parent version. Use the returned asset filename in the prototype.",
          input: Schema.Struct({ id: Design.ID, input: Design.ImportAsset }),
          output: Design.Asset,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: `Asset ${output.id}: assets/${output.id}-${output.name} (${output.mime}). Source: ${output.source}`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_asset", context)
              yield* owned(input.id, context)
              return yield* store.importAsset(input.id, input.input)
            }).pipe(Effect.catchTag("Design.Error", fail)),
        }),
        design_export: Tool.make({
          description:
            "Start a local HTML export, rendered scenario audit, or SVG-to-GIF export. Poll design_jobs for progress and the resulting file. GIF defaults: 3 seconds, 20 fps, 512px, continuous repeat.",
          input: Schema.Struct({ id: Design.ID, input: Design.Render }),
          output: Design.Job,
          toModelOutput: ({ output }) => [
            { type: "text", text: `Job ${output.id}: ${output.status}. Use design_jobs to read progress.` },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_export", context)
              yield* owned(input.id, context)
              return yield* renderer.start(input.id, input.input)
            }).pipe(Effect.catchTag("Design.Error", fail)),
        }),
        design_jobs: Tool.make({
          description:
            "Read export and audit progress. Interrupted jobs require an explicit new request; they never repeat a provider operation.",
          input: Schema.Struct({ id: Design.ID, cancel: Schema.optional(Schema.String) }),
          output: Schema.Array(Design.Job),
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: output
                .map(
                  (job) =>
                    `${job.id}: ${job.status} (${Math.round(job.progress * 100)}%) ${job.result ?? job.error ?? ""}`,
                )
                .join("\n"),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_jobs", context)
              yield* owned(input.id, context)
              if (input.cancel) return [yield* renderer.cancel(input.id, input.cancel)]
              return yield* renderer.jobs(input.id)
            }).pipe(Effect.catchTag("Design.Error", fail)),
        }),
        design_exit: Tool.make({
          description:
            "Ask the user to approve the currently published revision. Only after approval, update the design section of the plan and switch to Plan. Never silently approve open work.",
          input: Schema.Struct({ id: Design.ID }),
          output: Schema.Struct({ plan: Schema.String, revision: Schema.String }),
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: `Approved ${output.revision}. Recorded handoff: ${output.plan}. Continue within the goal scope and selected mode.`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_exit", context)
              const document = yield* owned(input.id, context)
              if (!document.revision)
                return yield* new ToolFailure({ message: "Publish the design before requesting approval" })
              const savedGoal = yield* goals
                .get(context.sessionID)
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
              const stay =
                savedGoal?.stopAfter === "design" && (savedGoal.status === "active" || savedGoal.status === "waiting")
              const audits = (yield* renderer.jobs(input.id)).filter(
                (job) => job.input.revision === document.revision && job.status === "completed" && job.audit,
              )
              const evidence = audits.length
                ? audits
                    .flatMap((job) => [
                      `Audit ${job.id}: ${job.audit!.scenarios.length} scenario observations; ${job.audit!.findings.length} findings.`,
                      ...job.audit!.findings,
                    ])
                    .join("\n")
                : "No completed audit for this revision."
              const answer = yield* questions
                .ask({
                  sessionID: context.sessionID,
                  tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                  questions: [
                    {
                      question: `Approve ${document.name} (${document.revision})? ${stay ? "The goal ends in Design." : "Approval continues in Plan."} Open questions: ${document.questions.join("; ") || "none"}\n${evidence}`,
                      header: "Design approval",
                      custom: false,
                      options: [
                        {
                          label: "Approve",
                          description: stay
                            ? "Record this revision and stay in Design"
                            : "Record this revision and switch to Plan",
                        },
                        { label: "Continue", description: "Keep reviewing this design" },
                      ],
                    },
                  ],
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
              if (answer[0]?.[0] !== "Approve")
                return yield* new ToolFailure({ message: "The user chose to continue reviewing" })
              const goal = yield* goals
                .get(context.sessionID)
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
              if (goal?.id !== savedGoal?.id || goal?.revision !== savedGoal?.revision)
                return yield* new ToolFailure({
                  message: "Goal changed during Design approval; review the current scope again",
                })
              const result = yield* store.approve(input.id, document.revision)
              if (stay) return result
              yield* events.publish(SessionEvent.AgentSwitched, {
                sessionID: context.sessionID,
                messageID: SessionMessage.ID.create(),
                timestamp: yield* DateTime.now,
                agent: "plan",
              })
              return result
            }).pipe(Effect.catchTag("Design.Error", fail)),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/design",
  layer,
  deps: [
    ToolRegistry.node,
    DesignStore.node,
    DesignRenderer.node,
    PermissionV2.node,
    QuestionV2.node,
    EventV2.node,
    SessionGoal.node,
    LocationMutation.node,
  ],
})
