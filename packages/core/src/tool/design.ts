export * as DesignTools from "./design"

import path from "node:path"
import { stat } from "node:fs/promises"
import { Cause, DateTime, Effect, Layer, Schema } from "effect"
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
import { DesignSystem } from "../design/system"
import { DesignBuild } from "../design/build"
import { DesignDocumentTool } from "../design/document-tool"
import { DesignQuality } from "../design/quality"
import { DesignApproval } from "../design/approval"
import { DesignRenderer } from "../design/renderer"
import { DesignPlaybooks } from "../design/playbooks"
import { DesignRounds } from "../design/rounds"
import { LocationMutation } from "../location-mutation"
import { Location } from "../location"
import { Global } from "../global"
import { DesignProposal } from "../design/proposal"
import type { ConfigDesign } from "../config/design"

/** The proposal outcome travels with the returned document in its manifest status, rendered by both runtimes. */
const withReport = (document: Design.Info, report: string) =>
  report ? { ...document, manifest: [document.manifest, report].filter(Boolean).join(". ") } : document

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const registry = yield* ToolRegistry.Service
    const store = yield* DesignStore.Service
    /** Screen markup warnings per published revision, rendered with the publish result. */
    const notices = new Map<string, string>()
    const renderer = yield* DesignRenderer.Service
    const permissions = yield* PermissionV2.Service
    const questions = yield* QuestionV2.Service
    const events = yield* EventV2.Service
    const goals = yield* SessionGoal.Service
    const mutation = yield* LocationMutation.Service
    const location = yield* Location.Service
    const global = yield* Global.Service

    const state = path.join(global.state, DesignProposal.STATE)
    // Asks once whether to adopt a detected design system when none is configured; see DesignProposal.
    const proposal = (context: Tool.Context, application?: string) =>
      Effect.map(store.configured(context.sessionID), (design) => ({
        directory: location.directory,
        application,
        state,
        global: global.config,
        configured: design?.system !== undefined,
        adopt: (design: ConfigDesign.Effective | undefined, committed?: boolean) =>
          store.adopt(context.sessionID, design, committed),
        ask: (request: ReturnType<typeof DesignProposal.question>) =>
          questions
            .ask({
              sessionID: context.sessionID,
              tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
              questions: [request],
            })
            .pipe(
              Effect.map((answers) => answers[0]?.[0]),
              // A dismissed question is "not now": the design goes on without the system.
              Effect.catch(() => Effect.succeed(undefined)),
            ),
      }))

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

    // Declared design-system roots are one standing read grant per design instead of a prompt per imported file.
    const standing = (document: Design.Info, context: Tool.Context) =>
      Effect.gen(function* () {
        const paths = yield* Effect.promise(() => DesignBuild.grant(document))
        if (!paths.length) return
        const targets = yield* Effect.forEach(paths, (file) =>
          Effect.all({
            target: mutation.resolve({ path: file, kind: "directory" }),
            directory: Effect.promise(() => stat(file).then((info) => info.isDirectory())),
          }),
        )
        const source = { type: "tool" as const, messageID: context.assistantMessageID, callID: context.toolCallID }
        const metadata = {
          origin: "design.system",
          reason:
            "Standing read grant for design builds: every preview of this design imports the declared design-system roots, stylesheets, tooling configuration and node_modules without further prompts.",
        }
        const external = [
          ...new Set(
            targets.flatMap(({ target }) => (target.externalDirectory ? [target.externalDirectory.resource] : [])),
          ),
        ]
        if (external.length)
          yield* permissions.assert({
            action: "external_directory",
            resources: external,
            save: external,
            sessionID: context.sessionID,
            agent: context.agent,
            source,
            metadata,
          })
        const resources = targets.map(({ target, directory }) => (directory ? `${target.resource}/*` : target.resource))
        yield* permissions.assert({
          action: "read",
          resources,
          save: resources,
          sessionID: context.sessionID,
          agent: context.agent,
          source,
          metadata,
        })
      }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
    // Running the project's PostCSS pipeline executes its configuration in this process, which a
    // read grant does not cover: a distinct permission names the files; a refusal builds without it.
    const execution = (document: Design.Info, context: Tool.Context) =>
      Effect.gen(function* () {
        const files = yield* Effect.promise(() => DesignBuild.tooling(document))
        if (!files.length) return false
        const resources = yield* Effect.forEach(files, (file) =>
          Effect.all({
            target: mutation.resolve({ path: file, kind: "directory" }),
            directory: Effect.promise(() => stat(file).then((info) => info.isDirectory())),
          }).pipe(Effect.map(({ target, directory }) => (directory ? `${target.resource}/*` : target.resource))),
        )
        return yield* permissions
          .assert({
            action: "project_tooling",
            resources,
            save: resources,
            sessionID: context.sessionID,
            agent: context.agent,
            source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
            metadata: {
              origin: "design.system",
              reason: `execute project tooling: ${files.map((file) => path.basename(file)).join(", ")} (runs in the redcode process)`,
            },
          })
          .pipe(
            Effect.as(true),
            // Only a refusal (deny rule, rejected prompt or correction) builds without the pipeline;
            // a rejected prompt arrives as a defect. Anything else surfaces as a tool error.
            Effect.catchCause((cause) => (refused(cause) ? Effect.succeed(false) : Effect.failCause(cause))),
          )
      }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))

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
          description: DesignDocumentTool.description,
          input: DesignDocumentTool.Input,
          // Documents, or the detection report of {"action":"detect"}.
          output: Schema.Union([Schema.Array(Design.Info), Schema.String]),
          toModelOutput: ({ input, output }) => [
            {
              type: "text",
              text:
                typeof output === "string"
                  ? output
                  : output
                      .map(
                        (document) =>
                          `Design ${document.id}: ${document.name}\nRoot: ${document.root}\nEngine: ${document.engine}\nEntry: ${document.entry}\nCurrent revision: ${document.revision ?? "unpublished"}\n${document.designSystem}\n${input.action === "list" ? `Design system: ${DesignSystem.summary(document) || "none detected"}` : DesignSystem.describe(document)}\nParams: ${JSON.stringify({ controls: document.controls ?? [], presets: document.presets ?? [] })}\nQuestions: ${document.questions.join("; ")}\nFeedback rounds: ${DesignRounds.summary(document)}`,
                      )
                      .join("\n\n"),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_document", context)
              if (input.action === "list") return yield* store.list(context.sessionID)
              if (input.action === "detect")
                return yield* Effect.promise(() =>
                  DesignProposal.detection({
                    directory: location.directory,
                    application: input.input?.application,
                    global: global.config,
                    state,
                  }),
                )
              yield* allow("design_edit", context)
              if (input.action === "create") {
                const created = yield* DesignProposal.around(
                  yield* proposal(context, input.input.application),
                  store.create(context.sessionID, input.input),
                )
                const document = withReport(created.value, created.report)
                if (context.agent !== "design")
                  yield* events.publish(SessionEvent.AgentSwitched, {
                    sessionID: context.sessionID,
                    messageID: SessionMessage.ID.create(),
                    timestamp: yield* DateTime.now,
                    agent: "design",
                  })
                return [document]
              }
              const current = yield* owned(input.id, context)
              if (input.action === "reopen") return [yield* store.reopen(input.id)]
              if (input.action === "refresh") {
                const refreshed = yield* DesignProposal.around(
                  yield* proposal(context, DesignStore.applicationOf(current)),
                  store.refresh(input.id),
                )
                return [withReport(refreshed.value, refreshed.report)]
              }
              return [yield* store.update(input.id, input.input)]
            }).pipe(Effect.catchTag("Design.Error", fail)),
        }),
        design_read: Tool.make({
          description:
            "Read the immutable approved Design: summary, decisions, scenarios, feedback, assets, evidence or prototype. Omit revision for the current approval; use file for exact snapshot source. Section snapshot returns the page text captured with a browser review note (optionally a specific feedback id) and needs no approval. Available during Plan and Build without reopening Design.",
          input: DesignApproval.Read,
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_read", context)
              yield* owned(input.id, context)
              return yield* store.readApproval(input)
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
              text: `Published ${output.id} for ${output.designID}. The user can annotate this revision. Root: ${output.document.root}${pipeline(output.document)}${notices.get(output.id) ?? ""}`,
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_preview", context)
              const document = yield* owned(input.id, context)
              yield* standing(document, context)
              const revision = yield* store.publish(
                input.id,
                input.name,
                read(context),
                yield* execution(document, context),
              )
              const notice = yield* Effect.promise(() =>
                DesignQuality.screenNotice(revision.document.root, revision.document.engine, revision.document.entry),
              )
              if (notice) {
                if (notices.size >= 64) notices.delete(notices.keys().next().value!)
                notices.set(revision.id, notice)
              }
              return revision
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
              const document = yield* owned(input.id, context)
              if (!input.restore) return yield* store.revisions(input.id)
              yield* standing(document, context)
              return [yield* store.restore(input.id, input.restore, read(context), yield* execution(document, context))]
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
            "Start a local HTML export, rendered scenario audit, implementation comparison, SVG-to-GIF export, or a feedback-round verify. Poll design_jobs for progress and the resulting file. Format verify renders the revision once and, for each note of the round (latest by default), locates its element, captures it before and after, runs the scenarios on its screen and axe/layout checks on its container; design_jobs then lists one line per note to cite when recording statuses. In a comparison, differences caused by real data or existing components are expected. GIF defaults: 3 seconds, 20 fps, 512px, continuous repeat.",
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
          output: Schema.Struct({
            jobs: Schema.Array(Design.Job),
            revision: Schema.NullOr(Schema.String),
            notes: Schema.Array(Design.Note).pipe(Schema.optional),
          }),
          toModelOutput: ({ output }) => [
            { type: "text", text: DesignQuality.report(output.jobs, output.revision, output.notes ?? []) },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* allow("design_jobs", context)
              const document = yield* owned(input.id, context)
              const jobs = input.cancel
                ? [yield* renderer.cancel(input.id, input.cancel)]
                : yield* renderer.jobs(input.id)
              return { jobs, revision: document.revision, notes: document.notes ?? [] }
            }).pipe(Effect.catchTag("Design.Error", fail)),
        }),
        design_exit: Tool.make({
          description:
            "Ask the user to approve the currently published revision. Only after approval, update the design section of the plan and switch to Plan. Never silently approve open work. Refused while the latest feedback round has notes without a recorded status.",
          input: Schema.Struct({
            id: Design.ID,
            variant: Schema.optional(Design.Variant),
            noTargets: Schema.optional(Schema.Boolean).annotate({ description: DesignApproval.NO_TARGETS }),
          }),
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
              if (DesignApproval.missingTargets(document, input.noTargets))
                return yield* new ToolFailure({ message: DesignApproval.TARGETS_NUDGE })
              const pending = DesignRounds.blocking(document)
              if (pending) return yield* new ToolFailure({ message: `Approval is not possible yet. ${pending}` })
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
                      question: `Approve ${document.name} (${document.revision}), ${input.variant ? `variant ${input.variant.name} (${input.variant.id})` : "entire revision"}? ${stay ? "The goal ends in Design." : "Approval continues in Plan."} Open questions: ${document.questions.join("; ") || "none"}\n${evidence}`,
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
              const result = yield* store.approve(input.id, document.revision, input.variant)
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
    Location.node,
    Global.node,
  ],
})

/** Whether the project's PostCSS pipeline ran for a revision; without it Tailwind utility classes are absent. */
function pipeline(document: { readonly system?: Design.System }) {
  if (!document.system) return ""
  return document.system.tailwind
    ? "\nProject PostCSS/Tailwind pipeline: ran."
    : "\nProject PostCSS/Tailwind pipeline: did not run for this revision (project tooling permission not granted, or tailwind off); Tailwind utility classes are absent."
}

function refused(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause)
  return (
    error instanceof PermissionV2.DeclinedError ||
    error instanceof PermissionV2.CorrectedError ||
    error instanceof PermissionV2.BlockedError
  )
}
