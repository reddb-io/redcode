import { DesignDocumentTool } from "@reddb-io/redcode-core/design/document-tool"
import { DesignApproval } from "@reddb-io/redcode-core/design/approval"
import { DesignReviewServer } from "@/design/review-server"
import { DesignLegacy } from "@/design/legacy"
import { DesignRead } from "@/design/read"
import { Provider } from "@/provider/provider"
import { DesignHandoff } from "@/design/handoff"
import { MCP } from "@/mcp"
import { McpCatalog } from "@/mcp/catalog"
import { Config } from "@/config/config"
import { Effect, Schema, Option } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { DesignRenderer } from "@reddb-io/redcode-core/design/renderer"
import { DesignPlaybooks } from "@reddb-io/redcode-core/design/playbooks"
import { DesignStudio } from "@/design/studio"
import { Tool } from "./tool"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionGoal } from "@/session/goal"

export const DesignTools = Effect.gen(function* () {
  const settings = yield* Config.Service
  const mcp = yield* MCP.Service
  const review = yield* DesignReviewServer.Service
  const studio = yield* DesignStudio.Service
  const provider = yield* Provider.Service
  const sessions = yield* Session.Service
  const questions = yield* Question.Service
  const run = <A, E>(
    name: string,
    ctx: Tool.Context,
    effect: Effect.Effect<A, E, DesignStore.Service | DesignRenderer.Service>,
  ) =>
    Effect.gen(function* () {
      yield* studio.assertSession(ctx.sessionID)
      yield* ctx.ask({ permission: name, patterns: ["*"], always: ["*"], metadata: {} })
      return yield* studio.use(effect)
    }).pipe(Effect.orDie)
  const result = (output: string, metadata: Record<string, unknown> = {}) => ({ title: "Design", output, metadata })
  return yield* Effect.all([
    define("design_media", {
      description:
        "List connected MCP tools with explicit image capabilities and their argument schemas. Use design_generate to generate or edit assets.",
      parameters: Schema.Struct({}),
      execute: (_input, ctx) =>
        run(
          "design_media",
          ctx,
          Effect.gen(function* () {
            const config = yield* settings.get()
            const available = yield* mcp.tools()
            const media = Object.entries(config.mcp ?? {}).flatMap(([server, value]) =>
              "type" in value
                ? Object.entries(value.media ?? {}).flatMap(([name, capability]) => {
                    const key = McpCatalog.toolName(server, name)
                    const tool = available[key]
                    return tool
                      ? [
                          `${key}: ${capability.operations.join(", ")}; ${capability.formats.join(", ")}; transparency ${capability.transparency}\nArguments (MCP JSON Schema): ${JSON.stringify(tool.def.inputSchema)}`,
                        ]
                      : []
                  })
                : [],
            )
            return result(
              media.join("\n\n") ||
                "No image-capable MCP tools are connected. Add explicit media declarations to the server configuration, or import a connected tool's output with design_asset.",
            )
          }),
        ),
    }),
    define("design_generate", {
      description:
        "Call one connected MCP image tool using its advertised arguments and import its inline images as versioned assets. Calls are never retried automatically.",
      parameters: Schema.Struct({
        id: Design.ID,
        tool: Schema.String,
        arguments: Schema.Record(Schema.String, Schema.Unknown),
        operation: Schema.Literals(["generate", "edit", "reference"]),
        parent: Schema.optional(Schema.String),
      }),
      execute: (input, ctx) =>
        run(
          "design_generate",
          ctx,
          Effect.gen(function* () {
            const store = yield* DesignStore.Service
            yield* store.get(input.id, ctx.sessionID)
            const config = yield* settings.get()
            const capability = Object.entries(config.mcp ?? {}).flatMap(([server, value]) =>
              "type" in value
                ? Object.entries(value.media ?? {})
                    .filter(([name]) => McpCatalog.toolName(server, name) === input.tool)
                    .map(([, media]) => media)
                : [],
            )[0]
            if (!capability?.operations.includes(input.operation))
              return yield* new Design.Error({
                code: "invalid",
                message: "This tool does not declare the requested image operation",
              })
            const tool = (yield* mcp.tools())[input.tool]
            if (!tool)
              return yield* new Design.Error({ code: "unavailable", message: "The image tool is disconnected" })
            yield* ctx.ask({
              permission: input.tool,
              patterns: ["*"],
              always: ["*"],
              metadata: { operation: input.operation },
            })
            const response = yield* Effect.tryPromise((signal) =>
              tool.client.callTool({ name: tool.def.name, arguments: input.arguments }, undefined, {
                signal,
                timeout: tool.timeout,
              }),
            )
            if (response.isError)
              return yield* new Design.Error({
                code: "unavailable",
                message: "Image generation failed; inspect the connected tool and retry explicitly",
              })
            const content = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown))(response.content)
            const assets = yield* Effect.forEach(content, (part) =>
              Effect.gen(function* () {
                const image = Schema.decodeUnknownOption(
                  Schema.Struct({ type: Schema.Literal("image"), mimeType: Schema.String, data: Schema.String }),
                )(part)
                if (Option.isNone(image)) return []
                const value = image.value
                const asset = yield* store.importAsset(
                  input.id,
                  yield* Schema.decodeUnknownEffect(Design.ImportAsset)({
                    name: `generated.${value.mimeType.split("/")[1]?.replace("svg+xml", "svg")}`,
                    mime: value.mimeType,
                    data: value.data,
                    source: input.tool,
                    parent: input.parent,
                  }),
                )
                return [asset]
              }),
            )
            if (!assets.flat().length)
              return result("The image tool returned no inline image. Import its local output using design_asset.")
            return result(
              assets
                .flat()
                .map((asset) => `Asset ${asset.id}: assets/${asset.id}-${asset.name}`)
                .join("\n"),
              { assets: assets.flat() },
            )
          }),
        ),
    }),

    define("design_playbook", {
      description: "Read guidance for screens, flows, comparisons and presentations before creating a prototype.",
      parameters: Schema.Struct({ id: Schema.optional(Schema.String) }),
      execute: (input, ctx) =>
        run(
          "design_playbook",
          ctx,
          Effect.sync(() => {
            const playbook = input.id ? DesignPlaybooks.find(input.id) : undefined
            return result(playbook ? DesignPlaybooks.render(playbook) : DesignPlaybooks.list())
          }),
        ),
    }),
    define("design_document", {
      description: DesignDocumentTool.description,
      parameters: DesignDocumentTool.Input,
      execute: (input, ctx) =>
        run(
          "design_document",
          ctx,
          Effect.gen(function* () {
            const store = yield* DesignStore.Service
            if (input.action === "list") return result((yield* store.list(ctx.sessionID)).map(describe).join("\n\n"))
            yield* ctx.ask({ permission: "design_edit", patterns: ["*"], always: ["*"], metadata: {} })
            if (input.action === "create") return result(describe(yield* store.create(ctx.sessionID, input.input)))
            yield* store.get(input.id, ctx.sessionID)
            const document =
              input.action === "update"
                ? yield* store.update(input.id, input.input)
                : input.action === "reopen"
                  ? yield* store.reopen(input.id)
                  : yield* store.refresh(input.id)
            return result(describe(document))
          }),
        ),
    }),
    define("design_preview", {
      description:
        'Publish an immutable revision and open its browser review after coherent edits. Supply id (the actual Design ID returned by design_document) and name (a label for this revision). If the ID is unknown, call design_document with {"action":"list"}, or create a document first. For a pre-0.22 prototype, supply path to its directory instead of id; name and reopen are optional for that import. Never call with empty arguments. Feedback returns to this same TUI conversation.',
      // Keep the provider-facing root an object; validate the two supported forms after decoding.
      parameters: Schema.Struct({
        id: Schema.optional(Design.ID).annotate({
          description: "Design ID returned by design_document. Required with name when publishing a current design.",
        }),
        name: Schema.optional(Schema.String).annotate({
          description: "Revision label. Required with id; optional when importing a legacy path.",
        }),
        path: Schema.optional(Schema.String).annotate({
          description: "Directory of a pre-0.22 prototype containing index.html. Use only instead of id for an import.",
        }),
        reopen: Schema.optional(Schema.Boolean).annotate({
          description: "For a legacy path only: reopen an ended review when the user explicitly requests it.",
        }),
      }).pipe(
        Schema.decodeTo(
          Schema.Union([
            Schema.Struct({ id: Design.ID, name: Schema.String }),
            Schema.Struct({
              path: Schema.String,
              name: Schema.optional(Schema.String),
              reopen: Schema.optional(Schema.Boolean),
            }),
          ]),
        ),
      ),
      formatValidationError: (error) =>
        `${String(error)}\nSupply {"id":"<actual Design ID>","name":"<revision label>"}. Find the ID with design_document {"action":"list"}, or create a design first. To import a pre-0.22 prototype, supply {"path":"<prototype directory>"} instead. Do not retry the same empty or incomplete arguments.`,
      execute: (input, ctx) =>
        run(
          "design_preview",
          ctx,
          Effect.gen(function* () {
            const store = yield* DesignStore.Service
            const document =
              "path" in input
                ? yield* DesignLegacy.importPrototype(input, ctx)
                : yield* store.get(input.id, ctx.sessionID)
            if (document.ended)
              return result(`The user ended this review. Reopen only on an explicit request. Design: ${document.id}`)
            const revision = yield* store.publish(
              document.id,
              input.name ?? document.name,
              yield* DesignRead.make(ctx.ask),
            )
            const url = new URL(`/design/session/${ctx.sessionID}/review`, yield* review.url).toString()
            if (!process.env.REDCODE_DESIGN_NO_OPEN)
              yield* Effect.promise(async () => {
                const { default: open } = await import("open")
                await open(url)
              }).pipe(Effect.ignore)
            return result(`Published ${revision.id}. Review: ${url}\nFeedback returns here. Continue using this TUI.`, {
              id: document.id,
              revision: revision.id,
              url,
            })
          }),
        ),
    }),
    define("design_read", {
      description:
        "Read the immutable approved Design: summary, decisions, scenarios, feedback, assets, evidence or prototype. Omit revision for the current approval; use file for exact snapshot source. Available during Plan and Build without reopening Design.",
      parameters: DesignApproval.Read,
      execute: (input, ctx) =>
        run(
          "design_read",
          ctx,
          Effect.gen(function* () {
            const store = yield* DesignStore.Service
            yield* store.get(input.id, ctx.sessionID)
            return result(yield* store.readApproval(input))
          }),
        ),
    }),
    define("design_history", {
      description: "List immutable alternatives or restore one as a new revision, retaining the approved baseline.",
      parameters: Schema.Struct({ id: Design.ID, restore: Schema.optional(Schema.String) }),
      execute: (input, ctx) =>
        run(
          "design_history",
          ctx,
          Effect.gen(function* () {
            const store = yield* DesignStore.Service
            yield* store.get(input.id, ctx.sessionID)
            const revisions = input.restore
              ? [yield* store.restore(input.id, input.restore, yield* DesignRead.make(ctx.ask))]
              : yield* store.revisions(input.id)
            return result(revisions.map((revision) => `${revision.id}: ${revision.name}`).join("\n"))
          }),
        ),
    }),
    define("design_asset", {
      description:
        "Import an image or editable SVG as a local versioned asset. Preserve its original source and parent version.",
      parameters: Schema.Struct({ id: Design.ID, input: Design.ImportAsset }),
      execute: (input, ctx) =>
        run(
          "design_asset",
          ctx,
          Effect.gen(function* () {
            const store = yield* DesignStore.Service
            yield* store.get(input.id, ctx.sessionID)
            const asset = yield* store.importAsset(input.id, input.input)
            return result(
              `Asset ${asset.id}: assets/${asset.id}-${asset.name} (${asset.mime}). Source: ${asset.source}`,
              { asset },
            )
          }),
        ),
    }),
    define("design_export", {
      description:
        "Start HTML export, rendered scenario audit, implementation comparison, or SVG-to-GIF export. Poll design_jobs. GIF defaults: 3 seconds, 20 fps, 512px, repeat.",
      parameters: Schema.Struct({ id: Design.ID, input: Design.Render }),
      execute: (input, ctx) =>
        run(
          "design_export",
          ctx,
          Effect.gen(function* () {
            const store = yield* DesignStore.Service
            const renderer = yield* DesignRenderer.Service
            yield* store.get(input.id, ctx.sessionID)
            const job = yield* renderer.start(input.id, input.input)
            return result(`Job ${job.id}: ${job.status}. Poll design_jobs for the result.`, { job })
          }),
        ),
    }),
    define("design_jobs", {
      description:
        "Read export/audit progress and result paths or cancel a job. Interrupted jobs require an explicit new request.",
      parameters: Schema.Struct({ id: Design.ID, cancel: Schema.optional(Schema.String) }),
      execute: (input, ctx) =>
        run(
          "design_jobs",
          ctx,
          Effect.gen(function* () {
            const store = yield* DesignStore.Service
            const renderer = yield* DesignRenderer.Service
            yield* store.get(input.id, ctx.sessionID)
            const jobs = input.cancel
              ? [yield* renderer.cancel(input.id, input.cancel)]
              : yield* renderer.jobs(input.id)
            return result(
              jobs
                .map(
                  (job) =>
                    `${job.id}: ${job.status} (${Math.round(job.progress * 100)}%) ${job.result ?? job.error ?? ""}`,
                )
                .join("\n"),
              { jobs },
            )
          }),
        ),
    }),
    define("design_exit", {
      description:
        "Ask the user to approve the published revision, record its immutable handoff, and continue in Plan in this same TUI session.",
      parameters: Schema.Struct({ id: Design.ID, variant: Schema.optional(Design.Variant) }),
      execute: (input, ctx) =>
        run(
          "design_exit",
          ctx,
          Effect.gen(function* () {
            const store = yield* DesignStore.Service
            const document = yield* store.get(input.id, ctx.sessionID)
            if (!document.revision)
              return yield* new Design.Error({ code: "conflict", message: "Publish the design before approval" })
            const savedGoal = SessionGoal.fromMetadata((yield* sessions.get(ctx.sessionID)).metadata)
            const stay = savedGoal?.status === "active" && savedGoal.stopAfter === "design"
            const answers = yield* questions
              .ask({
                sessionID: ctx.sessionID,
                tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
                questions: [
                  {
                    header: "Design approval",
                    custom: false,
                    question: `Approve ${document.name}, revision ${document.revision}, ${input.variant ? `variant ${input.variant.name} (${input.variant.id})` : "entire revision"}? Open questions: ${document.questions.join("; ") || "none"}`,
                    options: [
                      {
                        label: "Approve",
                        description: stay
                          ? "Record this revision and stay in Design"
                          : "Record this revision and continue in Plan",
                      },
                      { label: "Continue", description: "Keep reviewing" },
                    ],
                  },
                ],
              })
              .pipe(Effect.orDie)
            if (answers[0]?.[0] !== "Approve") return result("The user chose to continue reviewing.")
            const goal = SessionGoal.fromMetadata((yield* sessions.get(ctx.sessionID)).metadata)
            if (goal?.id !== savedGoal?.id || goal?.updated !== savedGoal?.updated)
              return yield* new Design.Error({
                code: "conflict",
                message: "Goal changed during approval; review the current scope again",
              })
            const approved = yield* DesignHandoff.approve(
              ctx.sessionID,
              input.id,
              document.revision,
              input.variant,
            ).pipe(
              Effect.provideService(DesignStudio.Service, studio),
              Effect.provideService(Session.Service, sessions),
              Effect.provideService(Provider.Service, provider),
            )
            return result(
              `Approved ${approved.revision}. Handoff: ${approved.plan}. Continue in ${approved.agent}.`,
              approved,
            )
          }),
        ),
    }),
  ])
})

function describe(document: Design.Info) {
  return `Design ${document.id}: ${document.name}\nRoot: ${document.root}\nEngine: ${document.engine}\nEntry: ${document.entry}\nRevision: ${document.revision ?? "unpublished"}\nPreview: design_preview ${JSON.stringify({ id: document.id, name: document.name })}\n${document.designSystem}\nQuestions: ${document.questions.join("; ")}`
}

function define<S extends Schema.Decoder<unknown>>(
  id: string,
  config: {
    description: string
    parameters: S
    formatValidationError?: (error: unknown) => string
    execute: (
      input: Schema.Schema.Type<S>,
      ctx: Tool.Context,
    ) => Effect.Effect<Tool.ExecuteResult<Record<string, unknown>>>
  },
) {
  return Tool.define(id, Effect.succeed(config)).pipe(Effect.flatMap((tool) => Tool.init(tool)))
}
