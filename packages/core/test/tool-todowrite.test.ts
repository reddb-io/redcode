import { Intelligence } from "../src/intelligence"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { Location } from "../src/location"
import { tempLocationLayer } from "./fixture/location"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@reddb-io/redcode-core/database/database"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { PermissionV2 } from "@reddb-io/redcode-core/permission"
import { Project } from "@reddb-io/redcode-core/project"
import { ProjectTable } from "@reddb-io/redcode-core/project/sql"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { SessionV2 } from "@reddb-io/redcode-core/session"
import { SessionTable } from "@reddb-io/redcode-core/session/sql"
import { SessionTodo } from "@reddb-io/redcode-core/session/todo"
import { TodoWriteTool } from "@reddb-io/redcode-core/tool/todowrite"
import { ToolRegistry } from "@reddb-io/redcode-core/tool/registry"
import { ToolOutputStore } from "@reddb-io/redcode-core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_todowrite_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let deny = false

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    rules: () => Effect.die("unused"),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Intelligence.node,
      EventV2.node,
      SessionTodo.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      TodoWriteTool.node,
    ]),
    [
      [PermissionV2.node, permission],
      [Location.node, tempLocationLayer],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

const setup = Effect.gen(function* () {
  assertions.length = 0
  deny = false
  const intelligence = yield* Intelligence.Service
  const previous = yield* intelligence.read()
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        port: 0,
        fetch: async (request) => {
          const body = await request.json()
          return Response.json({
            model: "jev",
            answers: Object.fromEntries(
              Object.entries(body.questions).map(([id, question]) => [
                id,
                (question as { type: string }).type === "score"
                  ? {
                      type: "score",
                      score: 3,
                      confidence: 1,
                      probabilities: { "3": 1 },
                      legend: { "0": "Unclear", "1": "Ambiguous", "2": "Clear", "3": "Precise" },
                    }
                  : { type: "noul", noul: 0.01 },
              ]),
            ),
            usage: { input_tokens: 10, output_tokens: 0 },
          })
        },
      }),
    ),
    (server) =>
      intelligence
        .save({ settings: previous })
        .pipe(Effect.orDie, Effect.ensuring(Effect.sync(() => server.stop(true)))),
  )
  yield* intelligence.save({
    settings: {
      enabled: true,
      reasoning: "dual",
      onboarding: "completed",
      principal: { providerID: Provider.ID.make("fixture"), id: Model.ID.make("principal") },
      evaluator: { transport: "typesafe", model: "jev", baseURL: `${server.url}v1` },
    },
  })
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "todowrite",
      directory: "/project",
      title: "todowrite",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const call = (todos: ReadonlyArray<SessionTodo.Info>, id = "call-todowrite") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: TodoWriteTool.name, input: { todos } },
})

describe("TodoWriteTool", () => {
  it.live("requires configured intelligence before a tool can create tasks", () =>
    Effect.gen(function* () {
      yield* setup
      const intelligence = yield* Intelligence.Service
      yield* intelligence.save({ settings: { ...(yield* intelligence.read()), enabled: false } })
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const result = yield* executeTool(
        registry,
        call([{ content: "Implement slice", status: "in_progress", priority: "high" }]),
      )
      expect(result.type).toBe("error")
      expect(result.value).toContain("Configure")
      expect(yield* service.get(sessionID)).toEqual([])
    }),
  )

  it.effect("registers, approves the wildcard resource, persists todos, and returns typed output", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const todoList: ReadonlyArray<SessionTodo.Info> = [
        { content: "Implement slice", status: "in_progress", priority: "high" },
      ]

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([TodoWriteTool.name])
      const result = yield* settleTool(registry, call(todoList))
      const stored = yield* service.get(sessionID)
      expect(stored.map((item) => ({ content: item.content, status: item.status, priority: item.priority }))).toEqual([
        ...todoList,
      ])
      expect(result).toEqual({
        result: { type: "text", value: JSON.stringify(stored, null, 2) },
        output: {
          structured: { todos: stored },
          content: [{ type: "text", text: JSON.stringify(stored, null, 2) }],
        },
      })
      expect(assertions).toMatchObject([{ sessionID, action: "todowrite", resources: ["*"], save: ["*"] }])
      expect(stored[0].id).toMatch(/^todo_/)
      const inspected = yield* settleTool(registry, call([]))
      expect(inspected.output?.structured).toMatchObject({
        todos: stored,
        availableEvidence: { requests: [], results: [] },
      })
      expect(inspected.result).toEqual({
        type: "text",
        value: JSON.stringify({ todos: stored, availableEvidence: { requests: [], results: [] } }, null, 2),
      })
    }),
  )

  it.effect("folds content aliases, quotes the correct shape on invalid input and updates by id alone", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const created = yield* settleTool(
        registry,
        call([{ text: "Implement slice", status: "in_progress", priority: "high" }] as never),
      )
      expect(created.output?.structured).toMatchObject({
        todos: [{ content: "Implement slice", status: "in_progress" }],
      })
      // A status no shape allows is refused; the first line names the key, and every problem is listed.
      const invalid = yield* executeTool(
        registry,
        call([{ content: "Bad status", status: "done", priority: "urgent" }] as never, "call-invalid"),
      )
      expect(invalid.type).toBe("error")
      const first = (invalid.value as string).split("\n").find((line) => line.includes("todos[0]"))
      expect(first).toContain("todos[0].status")
      expect(first).toContain("todos[0].priority")
      expect(invalid.value).toContain("Each todo needs either content and priority")
      expect(yield* service.get(sessionID)).toHaveLength(1)
      // A task created without a status starts pending; the automatic promotion then makes it active
      // when nothing else is in progress.
      const started = yield* settleTool(
        registry,
        call([{ content: "Without status", priority: "low" }] as never, "call-no-status"),
      )
      expect(started.output?.structured).toMatchObject({
        todos: [
          { content: "Implement slice", status: "in_progress" },
          { content: "Without status", status: "pending" },
        ],
      })
      const stored = (yield* service.get(sessionID))[0]
      const updated = yield* settleTool(
        registry,
        call(
          [{ id: stored.id, revision: stored.revision, status: "pending", reason: "Waiting" }] as never,
          "call-id-only",
        ),
      )
      expect(updated.output?.structured).toMatchObject({
        todos: [
          { id: stored.id, content: "Implement slice", priority: "high", status: "in_progress", reason: "Waiting" },
          { content: "Without status", status: "pending" },
        ],
      })
      expect((yield* toolDefinitions(registry))[0].inputSchema).not.toHaveProperty(
        "properties.todos.items.properties.text",
      )
    }),
  )

  it.effect("does not update persisted todos when permission is denied", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const service = yield* SessionTodo.Service
      const before = yield* service.update({
        sessionID,
        todos: [{ content: "keep", status: "pending", priority: "low" }],
      })
      deny = true

      expect(
        yield* executeTool(registry, call([{ content: "blocked", status: "completed", priority: "high" }])),
      ).toEqual({
        type: "error",
        value: "Unable to update todos",
      })
      expect(yield* service.get(sessionID)).toEqual(before)
      expect(assertions).toMatchObject([{ sessionID, action: "todowrite", resources: ["*"], save: ["*"] }])
    }),
  )
})
