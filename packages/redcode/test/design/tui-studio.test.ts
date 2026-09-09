import { SessionMessage } from "@reddb-io/redcode-schema/session-message"
import { DesignFeedback } from "../../src/design/feedback"
import { SessionStatus } from "../../src/session/status"
import { SessionPrompt } from "../../src/session/prompt"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { DesignLegacy } from "../../src/design/legacy"
import { TestInstance } from "../fixture/fixture"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { jsonSchema, streamText, tool } from "ai"
import { ToolJsonSchema } from "../../src/tool/json-schema"
import { ToolRegistry } from "../../src/tool/registry"
import { MessageID } from "../../src/session/schema"
import { Tool } from "../../src/tool/tool"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { expect } from "bun:test"
import { Effect, DateTime, Schema, Cause, Exit } from "effect"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { AppNodeBuilderV1 } from "../../src/effect/app-node-builder-v1"
import { DesignStudio } from "../../src/design/studio"
import { Session } from "../../src/session/session"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilderV1.build(
    LayerNode.group([
      DesignStudio.node,
      DesignFeedback.node,
      SessionStatus.node,
      SessionPrompt.node,
      EventV2Bridge.node,
      Agent.node,
      Session.node,
      SessionProjector.node,
      ToolRegistry.node,
      Permission.node,
    ]),
  ),
)

it.instance("Design remains a cyan primary mode and edits only prototype work", () =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const design = yield* agents.get("design")
    expect(design?.mode).toBe("primary")
    expect(design?.color).toBe("info")
    expect(design?.hidden).not.toBe(true)
    expect(Permission.evaluate("bash", "*", design!.permission).action).toBe("deny")
    expect(Permission.evaluate("edit", "src/product.ts", design!.permission).action).toBe("deny")
    expect(Permission.evaluate("design_document", "*", design!.permission).action).toBe("allow")
  }),
)

it.instance("the existing TUI session owns new revisions and SVG assets without a second session", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const studio = yield* DesignStudio.Service
    const session = yield* sessions.create({ agent: "design" })
    yield* studio.assertSession(session.id)
    yield* studio.use(
      Effect.gen(function* () {
        const store = yield* DesignStore.Service
        const document = yield* store.create(session.id, {
          name: "Settings",
          engine: "html",
          journey: "new",
          kind: "screen",
        })
        expect(document.sessionID).toBe(session.id)
        const agents = yield* Agent.Service
        const design = yield* agents.get("design")
        expect(Permission.evaluate("edit", document.root + "/index.html", design!.permission).action).toBe("allow")
        yield* Effect.promise(() =>
          Bun.write(document.root + "/index.html", "<!doctype html><html><body><button>Save</button></body></html>"),
        )
        const revision = yield* store.publish(document.id, "First direction")
        const asset = yield* store.importAsset(document.id, {
          name: "mark.svg",
          mime: "image/svg+xml",
          data: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="4"/></svg>',
          ).toString("base64"),
          source: "user",
        })
        expect(asset.mime).toBe("image/svg+xml")
        expect((yield* store.list(session.id)).map((item) => item.id)).toEqual([document.id])
        expect((yield* store.revisions(document.id))[0].id).toBe(revision.id)
        expect((yield* sessions.get(session.id)).agent).toBe("design")
      }),
    )
  }),
)

it.instance("Design document and preview expose their arguments in the OpenRouter request", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const tools = (yield* registry.all()).filter((tool) => ["design_document", "design_preview"].includes(tool.id))
    yield* Effect.promise(async () => {
      const requests: unknown[] = []
      await using server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          requests.push(await request.json())
          return Response.json({
            id: "fixture",
            created: 0,
            model: "z-ai/glm-5.3-flash",
            choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
          })
        },
      })
      await createOpenRouter({ apiKey: "fixture", baseURL: server.url.href })
        .chat("z-ai/glm-5.3-flash")
        .doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Design a dark mode" }] }],
          tools: tools.map((tool) => ({
            type: "function",
            name: tool.id,
            description: tool.description,
            inputSchema: ToolJsonSchema.fromTool(tool),
          })),
        })
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        tools: [
          {
            function: {
              parameters: {
                type: "object",
                required: ["action"],
                properties: {
                  action: { type: "string", enum: ["list", "create", "update", "reopen", "refresh"] },
                  id: { type: "string" },
                  input: { type: "object" },
                },
              },
            },
          },
          {
            function: {
              name: "design_preview",
              parameters: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  path: { type: "string" },
                  reopen: { type: "boolean" },
                },
              },
            },
          },
        ],
      })
      expect(requests[0]).not.toHaveProperty("tools.0.function.parameters.anyOf")
      expect(requests[0]).not.toHaveProperty("tools.1.function.parameters.anyOf")
    })
  }),
)

it.instance("Design preview preserves both input forms and rejects empty or incomplete arguments", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const preview = (yield* registry.all()).find((tool) => tool.id === "design_preview")!
    const decode = Schema.decodeUnknownSync(preview.parameters)
    for (const input of [
      { id: "design_fixture", name: "First direction" },
      { path: ".red/code/designs/legacy" },
      { path: ".red/code/designs/legacy", name: "Revisited", reopen: true },
    ]) {
      expect(decode(input)).toEqual(input)
    }
    for (const input of [{}, { id: "design_fixture" }, { name: "First direction" }, { path: 42 }]) {
      expect(() => decode(input)).toThrow()
    }
  }),
)

it.instance("every built-in Design tool exposes an object at the model schema root", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const tools = (yield* registry.all()).filter((tool) => tool.id.startsWith("design_"))
    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      const schema = ToolJsonSchema.fromTool(tool)
      expect(schema, tool.id).toHaveProperty("type", "object")
      expect(schema, tool.id).not.toHaveProperty("anyOf")
      expect(schema, tool.id).not.toHaveProperty("oneOf")
    }
  }),
)

it.instance("streamed OpenRouter preview arguments publish a revision in the same session", () =>
  Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const previous = process.env.REDCODE_DESIGN_NO_OPEN
        process.env.REDCODE_DESIGN_NO_OPEN = "1"
        return previous
      }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) {
            delete process.env.REDCODE_DESIGN_NO_OPEN
            return
          }
          process.env.REDCODE_DESIGN_NO_OPEN = previous
        }),
    )
    const sessions = yield* Session.Service
    const registry = yield* ToolRegistry.Service
    const studio = yield* DesignStudio.Service
    const session = yield* sessions.create({ agent: "design" })
    const tools = yield* registry.all()
    const document = tools.find((tool) => tool.id === "design_document")!
    const preview = tools.find((tool) => tool.id === "design_preview")!
    const context: Tool.Context = {
      sessionID: session.id,
      messageID: MessageID.ascending(),
      agent: "design",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => Effect.void,
      ask: () => Effect.void,
    }
    const created = yield* document.execute(
      { action: "create", input: { name: "Streamed preview", journey: "new", engine: "html", kind: "screen" } },
      context,
    )
    const args = Schema.decodeUnknownSync(
      Schema.fromJsonString(Schema.Struct({ id: Schema.String, name: Schema.String })),
    )(
      created.output
        .split("\n")
        .find((line) => line.startsWith("Preview: design_preview "))!
        .slice("Preview: design_preview ".length),
    )
    const input = yield* Effect.promise(async () => {
      const serialized = JSON.stringify(args)
      await using server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          const chunks = [serialized.slice(0, 8), serialized.slice(8, 20), serialized.slice(20)].map(
            (arguments_, index) => ({
              id: "fixture",
              created: 0,
              model: "z-ai/glm-5.3-flash",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        ...(index === 0 ? { id: "call_preview", type: "function" } : {}),
                        function: { ...(index === 0 ? { name: "design_preview" } : {}), arguments: arguments_ },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            }),
          )
          return new Response(
            [
              ...chunks,
              {
                id: "fixture",
                created: 0,
                model: "z-ai/glm-5.3-flash",
                choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
              },
            ]
              .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
              .join("") + "data: [DONE]\n\n",
            { headers: { "content-type": "text/event-stream" } },
          )
        },
      })
      const result = streamText({
        model: createOpenRouter({ apiKey: "fixture", baseURL: server.url.href }).chat("z-ai/glm-5.3-flash"),
        prompt: "Publish the current design",
        tools: {
          design_preview: tool({
            description: preview.description,
            inputSchema: jsonSchema(ToolJsonSchema.fromTool(preview)),
          }),
        },
      })
      const calls = await result.toolCalls
      expect(calls).toHaveLength(1)
      expect(calls[0]?.input).toEqual(args)
      return calls[0]!.input
    })
    const invalid = yield* preview.execute({}, context).pipe(Effect.exit)
    expect(Exit.isFailure(invalid)).toBe(true)
    if (Exit.isFailure(invalid)) {
      const error = invalid.cause.reasons.find(Cause.isDieReason)?.defect
      expect(error).toBeInstanceOf(Tool.InvalidArgumentsError)
      if (error instanceof Tool.InvalidArgumentsError) {
        expect(error.message).toContain('design_document {"action":"list"}')
        expect(error.message).toContain("Do not retry the same empty or incomplete arguments")
      }
    }
    const published = yield* preview.execute(input, context)
    expect(published.metadata.id).toBe(args.id)
    expect(published.metadata.url).toContain(`/design/session/${session.id}/review`)
    const designs = yield* studio.use(DesignStore.Service.use((store) => store.list(session.id)))
    expect(designs).toHaveLength(1)
    expect(designs[0]?.revision).toBe(published.metadata.revision)
    expect((yield* sessions.get(session.id)).agent).toBe("design")
  }),
)

it.instance("the TUI model receives and executes the new Design toolset", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const permissions = yield* Permission.Service
    const session = yield* sessions.create({ agent: "design" })
    const agent = yield* agents.get("design")
    const tools = yield* registry.all()
    expect(tools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining([
        "design_document",
        "design_preview",
        "design_asset",
        "design_media",
        "design_generate",
        "design_export",
        "design_jobs",
        "design_exit",
      ]),
    )
    const context: Tool.Context = {
      sessionID: session.id,
      messageID: MessageID.ascending(),
      agent: "design",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => Effect.void,
      ask: (request) =>
        permissions.ask({ ...request, sessionID: session.id, ruleset: agent!.permission }).pipe(Effect.orDie),
    }
    const document = yield* tools
      .find((tool) => tool.id === "design_document")!
      .execute(
        { action: "create", input: { name: "TUI tooling", engine: "html", journey: "new", kind: "screen" } },
        context,
      )
    expect(document.output).toContain("Root:")
    expect(document.output).toContain("TUI tooling")
    const root = document.output
      .split("\n")
      .find((line) => line.startsWith("Root: "))!
      .slice(6)
    const written = yield* tools
      .find((tool) => tool.id === "write")!
      .execute(
        { filePath: root + "/index.html", content: "<!doctype html><html><body>TUI write verified</body></html>" },
        context,
      )
    expect(written.output).not.toContain("denied")
    expect(yield* Effect.promise(() => Bun.file(root + "/index.html").text())).toContain("TUI write verified")
    const list = yield* tools.find((tool) => tool.id === "design_document")!.execute({ action: "list" }, context)
    expect(list.output).toContain("TUI tooling")
    const directory = (yield* TestInstance).directory
    const legacy = directory + "/.red/code/designs/previous"
    yield* Effect.promise(async () => {
      const { mkdir } = await import("node:fs/promises")
      await mkdir(legacy + "/.review", { recursive: true })
      await Bun.write(
        legacy + "/index.html",
        '<!doctype html><link rel="stylesheet" href="../../vendor/daisyui.css"><h1>Original prototype</h1>',
      )
      await Bun.write(legacy + "/.review/private.txt", "Private review notes")
      await Bun.write(
        legacy + "/design.json",
        JSON.stringify({ version: 1, decisions: ["Use a compact header"], questions: ["Which empty state?"] }),
      )
    })
    const studio = yield* DesignStudio.Service
    const imported = yield* studio.use(DesignLegacy.importPrototype({ path: legacy }, context))
    expect(imported.root).not.toBe(legacy)
    expect(imported.decisions.map((item) => item.text)).toContain("Use a compact header")
    expect(imported.questions).toContain("Which empty state?")
    expect(yield* Effect.promise(() => Bun.file(legacy + "/index.html").text())).toContain("../../vendor/daisyui.css")
    expect(yield* Effect.promise(() => Bun.file(imported.root + "/index.html").text())).toContain(
      'href="vendor/daisyui.css"',
    )
    expect(yield* Effect.promise(() => Bun.file(imported.root + "/.review/private.txt").exists())).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(legacy + "/.review/private.txt").text())).toBe("Private review notes")
  }),
)

it.instance("queued browser feedback does not restart an interrupted TUI session", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const studio = yield* DesignStudio.Service
    const feedback = yield* DesignFeedback.Service
    const status = yield* SessionStatus.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* sessions.create({ agent: "design" })
    const prompt = yield* SessionPrompt.Service
    const initial = yield* prompt.prompt({
      sessionID: session.id,
      agent: "design",
      noReply: true,
      parts: [{ type: "text", text: "Create a settings prototype" }],
    })
    const document = yield* studio.use(
      Effect.gen(function* () {
        const store = yield* DesignStore.Service
        const document = yield* store.create(session.id, {
          name: "Queue",
          journey: "new",
          engine: "html",
          kind: "screen",
        })
        const revision = yield* store.publish(document.id, "Queue review")
        return { id: document.id, revision: revision.id }
      }),
    )
    yield* status.set(session.id, { type: "busy" })
    const receipt = yield* feedback.admit(session.id, document.id, {
      id: SessionMessage.ID.make("msg_queued_interrupt"),
      revision: document.revision,
      text: "Wait for the current work",
      items: [],
      assets: [],
      snapshot: "",
      end: false,
      delivery: "queue",
    })
    expect(receipt.status).toBe("pending")
    yield* events.publish(SessionEvent.Turn.Ended, {
      sessionID: session.id,
      timestamp: yield* DateTime.now,
      finished: false,
    })
    yield* status.set(session.id, { type: "idle" })
    yield* Effect.sleep("2 seconds")
    expect((yield* sessions.messages({ sessionID: session.id })).map((message) => message.info.id)).toEqual([
      initial.info.id,
    ])
    expect(yield* status.get(session.id)).toEqual({ type: "idle" })
  }),
  {
    config: {
      model: "fixture/fixture",
      provider: {
        fixture: {
          npm: "@ai-sdk/openai-compatible",
          models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4096 } } },
          options: { apiKey: "fixture", baseURL: "http://127.0.0.1:1/v1" },
        },
      },
    },
  },
)
