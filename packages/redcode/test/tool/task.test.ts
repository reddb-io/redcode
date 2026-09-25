import { afterEach, describe, expect } from "bun:test"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Database } from "@reddb-io/redcode-core/database/database"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { SessionGoal } from "@/session/goal"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { Ripgrep } from "@reddb-io/redcode-core/ripgrep"
import { Session } from "@/session/session"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSpend } from "@/session/spend"

import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { SessionPlan } from "@reddb-io/redcode-core/session/plan"
import { SubagentReview } from "@reddb-io/redcode-core/session/subagent-review"
import { makeGlobalNode } from "@reddb-io/redcode-core/effect/app-node"
import { Todo } from "../../src/session/todo"
import { Provider } from "@/provider/provider"
import { HookV2Bridge } from "@/hook-v2-bridge"
import type { Hook } from "@reddb-io/redcode-schema/hook"
import path from "path"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

/** What the fake System One answers: every question in `flagged` is an error, the rest are clean. */
const s1 = { calls: 0, flagged: new Set<string>(), down: false }

const intelligenceNode = makeGlobalNode({
  service: Intelligence.Service,
  deps: [Database.node],
  layer: Layer.effect(
    Intelligence.Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const service = yield* Intelligence.make(
        path.join(process.env.XDG_CACHE_HOME!, "task-intelligence", crypto.randomUUID()),
        { get: () => Effect.succeed(undefined), list: () => Effect.succeed([]), create: () => Effect.die("unused") },
        Object.assign(
          async (_request: string | URL | Request, init?: RequestInit) => {
            s1.calls++
            if (s1.down) return new Response("unavailable", { status: 503 })
            const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> }
            return Response.json({
              model: "jev-test",
              usage: { input_tokens: 1, output_tokens: 1 },
              answers: Object.fromEntries(
                Object.keys(body.questions).map((id) => [id, { type: "noul", noul: s1.flagged.has(id) ? 1 : 0 }]),
              ),
            })
          },
          { preconnect() {} },
        ),
        {},
        database.db,
      )
      yield* service.save({
        settings: {
          enabled: true,
          reasoning: "dual",
          onboarding: "completed",
          principal: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("test-model") },
          evaluator: { transport: "typesafe", baseURL: "https://system-one.test/v1", model: "jev-test" },
        },
      })
      return service
    }).pipe(Effect.orDie),
  ),
})

/** What the SubagentStart and SubagentStop hooks were asked, and how they answer. */
const hookRuns: Array<Omit<Hook.Input, "cwd">> = []
let hookOutput: (input: Omit<Hook.Input, "cwd">) => Hook.Output = () => ({ continue: true })
const hookBridge = Layer.succeed(
  HookV2Bridge.Service,
  HookV2Bridge.Service.of({
    run: (input) =>
      Effect.sync(() => {
        hookRuns.push(input)
        return hookOutput(input)
      }),
  }),
)

const nodes = () =>
  LayerNode.group([
    Agent.node,
    BackgroundJob.node,
    EventV2Bridge.node,
    Config.node,
    CrossSpawnSpawner.node,
    Session.node,
    SessionProjector.node,
    SessionRunState.node,
    SessionStatus.node,
    ToolOutputBridge.node,
    ToolRegistry.node,
    Database.node,
    RuntimeFlags.node,
    Ripgrep.node,
    Intelligence.node,
    Todo.node,
    SessionPlan.node,
    SessionSpend.node,
    Provider.node,
  ])

const layer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  LayerNode.compile(nodes(), [
    [RuntimeFlags.node, RuntimeFlags.layer(flags)],
    [HookV2Bridge.node, hookBridge],
  ])

const it = testEffect(layer())
const background = testEffect(layer({ experimentalBackgroundSubagents: true }))
const noBackground = testEffect(layer({ experimentalBackgroundSubagents: false }))
const dual = testEffect(
  LayerNode.compile(nodes(), [
    [RuntimeFlags.node, RuntimeFlags.layer({})],
    [Intelligence.node, intelligenceNode],
    [HookV2Bridge.node, hookBridge],
  ]),
)
const dualBackground = testEffect(
  LayerNode.compile(nodes(), [
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalBackgroundSubagents: true })],
    [Intelligence.node, intelligenceNode],
    [HookV2Bridge.node, hookBridge],
  ]),
)

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const seed = Effect.fn("TaskToolTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    variant: "xhigh",
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

describe("tool.task", () => {
  it.instance(
    "description sorts subagents by name and is stable across calls",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const get = Effect.fnUntraced(function* () {
          const tools = yield* registry.tools({ ...ref, agent: build })
          return tools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
        })
        const first = yield* get()
        const second = yield* get()

        expect(first).toBe(second)

        const alpha = first.indexOf("- alpha: Alpha agent")
        const explore = first.indexOf("- explore:")
        const general = first.indexOf("- general:")
        const zebra = first.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      }),
    {
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance(
    "description hides denied subagents for the caller",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const description =
          (yield* registry.tools({ ...ref, agent: build })).find((tool) => tool.id === TaskTool.id)?.description ?? ""

        expect(description).toContain("- alpha: Alpha agent")
        expect(description).not.toContain("- zebra: Zebra agent")
      }),
    {
      config: {
        permission: {
          task: {
            "*": "allow",
            zebra: "deny",
          },
        },
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance("execute resumes an existing task session from task_id", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "resumed", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: child.id,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(child.id)
      expect(result.metadata.sessionId).toBe(child.id)
      expect(result.output).toContain(`<task id="${child.id}" state="completed">`)
      expect(seen?.sessionID).toBe(child.id)
      expect(seen?.variant).toBe("xhigh")
    }),
  )

  it.instance("execute asks by default and skips checks when bypassed", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const calls: unknown[] = []
      const promptOps = stubOps()

      const exec = (extra?: Record<string, any>) =>
        def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, ...extra },
            messages: [],
            metadata: () => Effect.void,
            ask: (input) =>
              Effect.sync(() => {
                calls.push(input)
              }),
          },
        )

      yield* exec()
      yield* exec({ bypassAgentCheck: true })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        permission: "task",
        patterns: ["general"],
        always: ["*"],
        metadata: {
          description: "inspect bug",
          subagent_type: "general",
        },
      })
    }),
  )

  it.instance("execute cancels child session when abort signal fires", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = defer<SessionPrompt.PromptInput>()
      const cancelled = defer<SessionID>()
      const abort = new AbortController()
      const promptOps: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.promise(() => {
            ready.resolve(input)
            return cancelled.promise
          }).pipe(Effect.as(reply(input, "cancelled"))),
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      const input = yield* Effect.promise(() => ready.promise)
      abort.abort()
      expect(yield* Effect.promise(() => cancelled.promise)).toBe(input.sessionID)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.instance("execute creates a child when task_id does not exist", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "created", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: "ses_missing",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(result.metadata.sessionId)
      expect(result.metadata.sessionId).not.toBe("ses_missing")
      expect(result.output).toContain(`<task id="${result.metadata.sessionId}" state="completed">`)
      expect(seen?.sessionID).toBe(result.metadata.sessionId)
    }),
  )

  it.instance("execute refuses a task_id that did not descend from the calling session", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const { chat: other } = yield* seed("Other project")
      const cousin = yield* sessions.create({ parentID: other.id, title: "Other child" })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = 0
      const promptOps = stubOps({ onPrompt: () => prompted++ })

      const exec = (task_id: string) =>
        def
          .execute(
            {
              description: "inspect bug",
              prompt: "look into the cache key path",
              subagent_type: "general",
              task_id,
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)

      for (const foreign of [other.id, cousin.id, chat.id]) {
        const exit = yield* exec(foreign)
        expect(Exit.isFailure(exit)).toBe(true)
        const message = Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : ""
        expect(message).toContain("must reference a subagent session started from this session")
      }
      expect(prompted).toBe(0)
      expect(yield* sessions.children(chat.id)).toHaveLength(0)
      expect(yield* sessions.children(other.id)).toHaveLength(1)
    }),
  )

  it.instance("execute caps depth on the resumed chain, not on the caller", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      const grandchild = yield* sessions.create({ parentID: child.id, title: "grandchild" })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = 0
      const promptOps = stubOps({ onPrompt: () => prompted++ })

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            task_id: grandchild.id,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const message = Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : ""
      expect(message).toContain("Subagent depth limit reached (1)")
      expect(prompted).toBe(0)
    }),
  )

  it.instance("prevents subagents from launching subagents by default", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      const nestedAssistant = yield* sessions.updateMessage({
        ...assistant,
        id: MessageID.ascending(),
        parentID: MessageID.ascending(),
        sessionID: child.id,
      })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let asked = false

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: child.id,
            messageID: nestedAssistant.id,
            agent: "general",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.sync(() => (asked = true)),
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(asked).toBe(false)
      expect(yield* sessions.children(child.id)).toHaveLength(0)
    }),
  )

  it.instance(
    "allows nested subagents up to the configured depth",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const child = yield* sessions.create({ parentID: chat.id, title: "child" })
        const nestedAssistant = yield* sessions.updateMessage({
          ...assistant,
          id: MessageID.ascending(),
          parentID: MessageID.ascending(),
          sessionID: child.id,
        })
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: child.id,
            messageID: nestedAssistant.id,
            agent: "general",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect((yield* sessions.get(result.metadata.sessionId)).parentID).toBe(child.id)
      }),
    { config: { subagent_depth: 2 } },
  )

  it.instance(
    "execute shapes child permissions for task, todowrite, and primary tools",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "reviewer",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.parentID).toBe(chat.id)
        expect(child.agent).toBe("reviewer")
        expect(child.permission).toEqual([
          {
            permission: "todowrite",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "bash",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "read",
            pattern: "*",
            action: "deny",
          },
        ])
        expect(seen?.tools).toBeUndefined()
      }),
    {
      config: {
        agent: {
          reviewer: {
            mode: "subagent",
            permission: {
              task: "allow",
            },
          },
        },
        experimental: {
          primary_tools: ["bash", "read"],
        },
      },
    },
  )

  noBackground.instance("rejects background execution when the flag turns it off", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            background: true,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.instance("promotes a running foreground task without restarting it", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = yield* Deferred.make<void>()
      const done = yield* Deferred.make<void>()
      const injected = yield* Deferred.make<SessionPrompt.PromptInput>()
      let runs = 0
      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            return Deferred.succeed(injected, input).pipe(Effect.as(reply(input, "injected")))
          }
          return Effect.gen(function* () {
            runs += 1
            yield* Deferred.succeed(ready, undefined)
            yield* Deferred.await(done)
            return reply(input, "background done")
          })
        },
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      yield* Deferred.await(ready)
      const job = (yield* jobs.list())[0]
      expect(job).toBeDefined()
      if (!job) throw new Error("task job not found")
      expect(job.metadata?.parentSessionId).toBe(chat.id)
      yield* jobs.promote(job.id)

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain(`state="running"`)
      expect((yield* jobs.get(result.metadata.sessionId))?.status).toBe("running")
      expect(runs).toBe(1)

      yield* Deferred.succeed(done, undefined)
      expect((yield* jobs.wait({ id: result.metadata.sessionId })).info?.output).toBe("background done")
      expect((yield* Deferred.await(injected)).parts[0]?.type).toBe("text")
      expect(runs).toBe(1)
    }),
  )

  background.instance("execute launches background tasks without waiting for completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const job = yield* jobs.get(result.metadata.sessionId)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain(`state="running"`)
      expect(job?.status).toBe("running")
    }),
  )

  background.instance("background task completion waits for running updates", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const first = defer<void>()
      const second = defer<void>()
      const updated = defer<SessionPrompt.PromptInput>()
      const injected = defer<SessionPrompt.PromptInput>()
      let prompts = 0
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            injected.resolve(input)
            return Effect.succeed(reply(input, "done"))
          }
          prompts++
          if (prompts === 1) return Effect.promise(() => first.promise).pipe(Effect.as(reply(input, "first done")))
          updated.resolve(input)
          return Effect.promise(() => second.promise).pipe(Effect.as(reply(input, "second done")))
        },
      }
      const context = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const started = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        context,
      )
      const result = yield* def.execute(
        {
          description: "add investigation scope",
          prompt: "also inspect cancellation",
          subagent_type: "general",
          task_id: started.metadata.sessionId,
        },
        context,
      )

      expect(result.metadata.sessionId).toBe(started.metadata.sessionId)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain("Background task updated")
      first.resolve()
      expect((yield* jobs.get(started.metadata.sessionId))?.status).toBe("running")
      expect((yield* Effect.promise(() => updated.promise)).parts).toEqual([
        { type: "text", text: "also inspect cancellation" },
      ])

      second.resolve()
      const waited = yield* jobs.wait({ id: started.metadata.sessionId, timeout: 1_000 })
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("second done")
      const notification = yield* Effect.promise(() => injected.promise)
      expect(notification.variant).toBe("xhigh")
      expect(notification.parts[0]?.type).toBe("text")
      if (notification.parts[0]?.type === "text") expect(notification.parts[0].text).toContain("second done")
    }),
  )

  background.instance("background tasks complete through the background job service", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ text: "background done" }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("background done")
    }),
  )

  background.instance("background task completion does not wait for the parent async prompt", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps({ text: "background done" }),
              prompt: (input) =>
                input.sessionID === chat.id ? Effect.never : Effect.succeed(reply(input, "background done")),
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
    }),
  )

  background.instance("removing the parent session cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance("removing the child task session cancels its running background task", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(result.metadata.sessionId)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance("cancelling the parent run cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* runState.cancel(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  it.instance("cancelling a child run cancels its own pre-runner task job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })

      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: chat.id, sessionId: child.id },
        run: Effect.never,
      })

      yield* runState.cancel(child.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
    }),
  )

  it.instance("cancelling a parent run recursively cancels descendant background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      const grandchild = yield* sessions.create({ parentID: child.id, title: "grandchild" })

      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: chat.id, sessionId: child.id },
        run: Effect.never,
      })
      yield* jobs.start({
        id: grandchild.id,
        type: "task",
        metadata: { parentSessionId: child.id, sessionId: grandchild.id },
        run: Effect.never,
      })

      yield* runState.cancel(chat.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
      expect((yield* jobs.get(grandchild.id))?.status).toBe("cancelled")
    }),
  )

  it.instance("the child's prompt opens with the parent's active goal; a paused goal stays home", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const goal = SessionGoal.parse("fix the cache key; verify: bun test", {})
      yield* sessions.setMetadata({ sessionID: chat.id, metadata: SessionGoal.toMetadata({}, goal) })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const seen: SessionPrompt.PromptInput[] = []
      const promptOps = stubOps({ onPrompt: (input) => void seen.push(input) })
      const ctx = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }
      const params = { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "general" }

      yield* def.execute(params, ctx)
      const first = seen[0]?.parts ?? []
      expect(first).toHaveLength(2)
      expect(first[0]?.type === "text" && first[0].synthetic).toBe(true)
      expect(first[0]?.type === "text" ? first[0].text : "").toContain("Objective: fix the cache key")
      expect(first[0]?.type === "text" ? first[0].text : "").toContain("Verification: bun test")
      expect(first[1]?.type === "text" ? first[1].text : "").toBe("look into the cache key path")

      yield* sessions.setMetadata({
        sessionID: chat.id,
        metadata: SessionGoal.toMetadata({}, { ...goal, status: "paused", reason: "interrupted" }),
      })
      yield* def.execute(params, ctx)
      expect(seen[1]?.parts).toHaveLength(1)
    }),
  )

  it.instance(
    "refuses a background subagent past the session's cap and says to wait or run it inline",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const done = yield* Deferred.make<void>()
        const promptOps: TaskPromptOps = {
          cancel: () => Effect.void,
          resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
          prompt: (input) =>
            input.sessionID === chat.id
              ? Effect.succeed(reply(input, "injected"))
              : Deferred.await(done).pipe(Effect.as(reply(input, "background done"))),
        }
        const ctx = {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        }
        const first = yield* def.execute(
          { description: "one", prompt: "first job", subagent_type: "general", background: true },
          ctx,
        )
        expect(first.metadata.background).toBe(true)

        const second = yield* def
          .execute({ description: "two", prompt: "second job", subagent_type: "general", background: true }, ctx)
          .pipe(Effect.exit)
        expect(Exit.isFailure(second)).toBe(true)
        const message = Exit.isFailure(second) ? String(Cause.squash(second.cause)) : ""
        expect(message).toContain("limit 1")
        expect(message).toContain("run this task in the foreground")

        // A foreground task is not capped: it is the caller's own turn waiting.
        const inline = yield* def
          .execute({ description: "three", prompt: "third job", subagent_type: "general" }, ctx)
          .pipe(Effect.forkChild)
        yield* Deferred.succeed(done, undefined)
        expect((yield* Fiber.join(inline)).output).toContain("background done")
      }),
    { config: { experimental: { background_subagents_max: 1 } } },
  )

  it.instance(
    "a running foreground task does not count against the background cap",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const ready = yield* Deferred.make<void>()
        const done = yield* Deferred.make<void>()
        const promptOps: TaskPromptOps = {
          cancel: () => Effect.void,
          resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
          prompt: (input) =>
            input.sessionID === chat.id
              ? Effect.succeed(reply(input, "injected"))
              : Deferred.succeed(ready, undefined).pipe(
                  Effect.andThen(Deferred.await(done)),
                  Effect.as(reply(input, "subagent done")),
                ),
        }
        const ctx = {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        }
        const inline = yield* def
          .execute({ description: "one", prompt: "first job", subagent_type: "general" }, ctx)
          .pipe(Effect.forkChild)
        yield* Deferred.await(ready)

        const launched = yield* def.execute(
          { description: "two", prompt: "second job", subagent_type: "general", background: true },
          ctx,
        )
        expect(launched.metadata.background).toBe(true)

        yield* Deferred.succeed(done, undefined)
        expect((yield* Fiber.join(inline)).output).toContain("subagent done")
      }),
    { config: { experimental: { background_subagents_max: 1 } } },
  )
})

const brief = {
  description: "inspect bug",
  prompt: "Find where the cache key is built in src/cache and explain why two tenants can collide.",
  subagent_type: "general",
  scope: ["src/cache/**"],
  done_criteria: ["the function that builds the key is named with its file and line"],
  return_format: "file:line and a two-sentence explanation",
}

function context(chat: SessionID, assistant: MessageID, promptOps: TaskPromptOps, extra?: Record<string, unknown>) {
  return {
    sessionID: chat,
    messageID: assistant,
    agent: "build",
    abort: new AbortController().signal,
    callID: "call_task",
    extra: { promptOps, ...extra },
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

const failure = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : "")

describe("tool.task hooks", () => {
  it.instance("SubagentStart adds its context; a SubagentStop that blocks sends its reason back once", () =>
    Effect.gen(function* () {
      hookRuns.length = 0
      hookOutput = (input) =>
        input.event === "SubagentStart"
          ? { continue: true, additionalContext: "Hook context: prefer tables." }
          : { continue: false, reason: "Cite the files you read." }
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const prompts: SessionPrompt.PromptInput[] = []
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) =>
          Effect.sync(() => {
            prompts.push(input)
            return reply(input, prompts.length === 1 ? "The cache key is built in one place." : "cache.ts:12 builds it.")
          }),
      }

      const result = yield* def
        .execute(
          { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "general" },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.ensuring(Effect.sync(() => (hookOutput = () => ({ continue: true })))))

      const child = result.metadata.sessionId
      expect(hookRuns.filter((input) => input.event === "SubagentStart")).toEqual([
        { event: "SubagentStart", matcher: "general", session_id: chat.id, agent_id: child, agent_type: "general" },
      ])
      expect(hookRuns.filter((input) => input.event === "SubagentStop")).toEqual([
        {
          event: "SubagentStop",
          matcher: "general",
          session_id: chat.id,
          agent_id: child,
          agent_type: "general",
          last_assistant_message: "The cache key is built in one place.",
        },
      ])
      expect(prompts[0]?.parts).toContainEqual(
        expect.objectContaining({ type: "text", text: "Hook context: prefer tables." }),
      )
      expect(prompts).toHaveLength(2)
      expect(prompts[1]?.parts).toEqual([expect.objectContaining({ type: "text", text: "Cite the files you read." })])
      expect(result.output).toContain("cache.ts:12 builds it.")
    }),
  )
})

describe("tool.task brief review", () => {
  dual.instance("a brief S1 rejects fails the call with the issues and launches nothing", () =>
    Effect.gen(function* () {
      s1.calls = 0
      s1.down = false
      s1.flagged = new Set(["missing_done_criteria", "missing_context"])
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      let prompted = false
      const exit = yield* def
        .execute(brief, context(chat.id, assistant.id, stubOps({ onPrompt: () => (prompted = true) })))
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(failure(exit)).toContain("needs revision")
      expect(failure(exit)).toContain("missing_done_criteria")
      expect(failure(exit)).toContain("done_criteria")
      expect(failure(exit)).toContain("blank context")
      expect(s1.calls).toBeGreaterThan(0)
      expect(prompted).toBe(false)
      expect(yield* sessions.children(chat.id)).toHaveLength(0)
    }),
  )

  dual.instance("a revised brief S1 accepts proceeds and is kept in the child's metadata", () =>
    Effect.gen(function* () {
      s1.down = false
      s1.flagged = new Set(["missing_done_criteria"])
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      const seen: SessionPrompt.PromptInput[] = []
      const ctx = context(chat.id, assistant.id, stubOps({ onPrompt: (input) => void seen.push(input) }))

      expect(Exit.isFailure(yield* def.execute({ ...brief, done_criteria: undefined }, ctx).pipe(Effect.exit))).toBe(
        true,
      )
      s1.flagged = new Set()
      const result = yield* def.execute(brief, ctx)

      expect(result.output).toContain("done")
      expect(result.output).not.toContain("<brief_review")
      expect(result.metadata.brief?.verdict).toBe("verified")
      const stored = SubagentReview.fromMetadata((yield* sessions.get(result.metadata.sessionId)).metadata)
      expect(stored?.verdict).toBe("verified")
      expect(stored?.brief).toBe(brief.prompt)
      expect(stored?.scope).toEqual(brief.scope)
      expect(stored?.criteria).toEqual(brief.done_criteria)
      expect(stored?.returnFormat).toBe(brief.return_format)
      expect(stored?.parentSessionID).toBe(chat.id)
      expect(stored?.callID).toBe("call_task")
      expect(stored?.briefEvaluationID).toBe(result.metadata.brief?.evaluationID)
      expect(stored?.writeCapable).toBe(true)
      // The subagent reads the structured half of its brief after the prompt.
      const text = seen[0]?.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ?? ""
      expect(text).toContain("- src/cache/**")
      expect(text).toContain(brief.done_criteria[0])
    }),
  )

  dual.instance("a second rejection for the same request proceeds with a warning", () =>
    Effect.gen(function* () {
      s1.down = false
      s1.flagged = new Set(["overreach"])
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      const ctx = context(chat.id, assistant.id, stubOps())

      const first = yield* def.execute(brief, ctx).pipe(Effect.exit)
      expect(failure(first)).toContain("overreach")
      const second = yield* def.execute({ ...brief, prompt: `${brief.prompt} Do not change any file.` }, ctx)

      expect(second.output).toContain(`<brief_review verdict="needs_revision">`)
      expect(second.output).toContain("overreach")
      expect(second.output).toContain("done")
      expect(second.metadata.brief?.verdict).toBe("needs_revision")
    }),
  )

  dual.instance("unavailable S1 proceeds with a visible warning, never a silent approval", () =>
    Effect.gen(function* () {
      s1.down = true
      s1.flagged = new Set()
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      const result = yield* def.execute(brief, context(chat.id, assistant.id, stubOps()))
      s1.down = false

      expect(result.output).toContain(`<brief_review verdict="inconclusive">`)
      expect(result.output).toContain("S1 could not review the brief")
      expect(result.metadata.brief?.verdict).toBe("inconclusive")
    }),
  )

  dual.instance("a brief the user wrote, from a command or an @mention, is not reviewed", () =>
    Effect.gen(function* () {
      s1.calls = 0
      s1.down = false
      s1.flagged = new Set(Object.keys(SubagentReview.briefQuestions))
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      const result = yield* def.execute(
        { description: "review", prompt: "review", subagent_type: "general" },
        context(chat.id, assistant.id, stubOps(), { bypassAgentCheck: true }),
      )

      expect(s1.calls).toBe(0)
      expect(result.output).not.toContain("<brief_review")
      expect(SubagentReview.fromMetadata((yield* sessions.get(result.metadata.sessionId)).metadata)?.verdict).toBe(
        "skipped",
      )
    }),
  )

  dual.instance("single reasoning checks structure only, never calls S1, and labels the result unverified", () =>
    Effect.gen(function* () {
      const intelligence = yield* Intelligence.Service
      yield* intelligence.save({ settings: { ...(yield* intelligence.read()), reasoning: "single" } })
      s1.calls = 0
      s1.down = false
      s1.flagged = new Set(Object.keys(SubagentReview.briefQuestions))
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      const result = yield* def.execute(
        { description: "inspect bug", prompt: "look into the cache key path", subagent_type: "general" },
        context(chat.id, assistant.id, stubOps()),
      )

      expect(s1.calls).toBe(0)
      expect(result.output).toContain(`<brief_review verdict="unverified">`)
      expect(result.output).toContain(Intelligence.UNVERIFIED)
      expect(result.output).toContain("No done_criteria")
      expect(result.metadata.brief?.verdict).toBe("unverified")
      expect(SubagentReview.fromMetadata((yield* sessions.get(result.metadata.sessionId)).metadata)?.verdict).toBe(
        "unverified",
      )
    }),
  )

  it.instance("an empty prompt is refused in every mode", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      const exit = yield* def
        .execute({ ...brief, prompt: "  " }, context(chat.id, assistant.id, stubOps()))
        .pipe(Effect.exit)

      expect(failure(exit)).toContain("empty_prompt")
      expect(yield* sessions.children(chat.id)).toHaveLength(0)
    }),
  )
})

describe("tool.task fan-out caps", () => {
  it.instance(
    "refuses a foreground subagent past the session's concurrency cap",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const def = yield* (yield* TaskTool).init()
        const ready = yield* Deferred.make<void>()
        const done = yield* Deferred.make<void>()
        const promptOps: TaskPromptOps = {
          cancel: () => Effect.void,
          resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
          prompt: (input) =>
            Deferred.succeed(ready, undefined).pipe(
              Effect.andThen(Deferred.await(done)),
              Effect.as(reply(input, "first done")),
            ),
        }
        const ctx = context(chat.id, assistant.id, promptOps)
        const first = yield* def.execute(brief, ctx).pipe(Effect.forkChild)
        yield* Deferred.await(ready)

        const second = yield* def.execute(brief, ctx).pipe(Effect.exit)
        expect(failure(second)).toContain("limit 1")
        expect(failure(second)).toContain("Wait for one to finish")

        yield* Deferred.succeed(done, undefined)
        expect((yield* Fiber.join(first)).output).toContain("first done")
        // The slot is released once the first returns.
        expect((yield* def.execute(brief, ctx)).output).toContain("first done")
      }),
    { config: { experimental: { subagent_limits: { concurrent: 1 } } } },
  )

  it.instance(
    "refuses new subagents past the per-request cap, but a resume is not a new one",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const def = yield* (yield* TaskTool).init()
        const ctx = context(chat.id, assistant.id, stubOps())
        const first = yield* def.execute(brief, ctx)

        const second = yield* def.execute(brief, ctx).pipe(Effect.exit)
        expect(failure(second)).toContain("limit 1")
        expect(failure(second)).toContain("already started for this request")

        const resumed = yield* def.execute({ ...brief, task_id: first.metadata.sessionId }, ctx)
        expect(resumed.metadata.sessionId).toBe(first.metadata.sessionId)
      }),
    { config: { experimental: { subagent_limits: { per_request: 1 } } } },
  )
})

/** A subagent's final message with the tool calls it made on the way: [tool, input, exit code]. */
function worked(
  input: SessionPrompt.PromptInput,
  text: string,
  calls: ReadonlyArray<readonly [string, Record<string, unknown>, number?]>,
): SessionV1.WithParts {
  const message = reply(input, text)
  return {
    ...message,
    parts: [
      ...calls.map(
        ([tool, args, exit]): SessionV1.Part => ({
          id: PartID.ascending(),
          messageID: message.info.id,
          sessionID: input.sessionID,
          type: "tool",
          callID: `call_${crypto.randomUUID()}`,
          tool,
          state: {
            status: "completed",
            input: args,
            output: exit === undefined ? "ok" : `exit ${exit}`,
            title: tool,
            metadata: exit === undefined ? {} : { exit },
            time: { start: 1, end: 2 },
          },
        }),
      ),
      ...message.parts,
    ],
  }
}

const promptText = (input: SessionPrompt.PromptInput) =>
  input.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

/** What a subagent that did the job hands back: the criterion named, the change in scope, the check passing. */
const DONE = "The key is built by cacheKey in src/cache/key.ts line 12, named with its file and line; bun test passes."

describe("tool.task result review", () => {
  dual.instance("a result that meets the brief is verified, and its S1 spend is the parent's", () =>
    Effect.gen(function* () {
      s1.calls = 0
      s1.down = false
      s1.flagged = new Set()
      const sessions = yield* Session.Service
      const spend = yield* SessionSpend.Service
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      const seen: SessionPrompt.PromptInput[] = []
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) =>
          Effect.sync(() => {
            seen.push(input)
            return worked(input, DONE, [
              ["edit", { filePath: "src/cache/key.ts" }],
              ["bash", { command: "bun test test/cache" }, 0],
            ])
          }),
      }
      const result = yield* def.execute(brief, context(chat.id, assistant.id, promptOps))

      expect(seen).toHaveLength(1)
      expect(result.output).toContain(`<review decision="verified">`)
      expect(result.output).toContain(DONE)
      expect(result.metadata).toMatchObject({ review: { decision: "verified", issues: [], repaired: false } })
      const stored = SubagentReview.fromMetadata((yield* sessions.get(result.metadata.sessionId)).metadata)
      expect(stored?.result?.decision).toBe("verified")
      // One brief review and one result review, each reporting one input and one output token.
      expect(s1.calls).toBe(2)
      expect((yield* spend.totals(chat.id)).tokens).toBe(4)
    }),
  )

  dual.instance("an incomplete result gets one repair round in the same subagent, then a verdict", () =>
    Effect.gen(function* () {
      s1.down = false
      s1.flagged = new Set(["unmet_criterion", "missing_output"])
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      const seen: SessionPrompt.PromptInput[] = []
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) =>
          Effect.sync(() => {
            seen.push(input)
            if (!promptText(input).startsWith(SubagentReview.REPAIR)) return reply(input, "Looked around.")
            // The repaired result holds up.
            s1.flagged = new Set()
            return worked(input, DONE, [["bash", { command: "bun test test/cache" }, 0]])
          }),
      }
      const result = yield* def.execute(brief, context(chat.id, assistant.id, promptOps))

      expect(seen).toHaveLength(2)
      expect(seen[1]?.sessionID).toBe(seen[0]?.sessionID)
      const repair = promptText(seen[1]!)
      expect(repair).toContain("unmet_criterion")
      expect(repair).toContain("missing_output")
      expect(repair).toContain("only repair round")
      expect(result.output).toContain(`<review decision="verified" repaired="true">`)
      expect(result.output).toContain(DONE)
      expect(result.output).not.toContain("Looked around.")
      expect(result.metadata).toMatchObject({ review: { decision: "verified", repaired: true } })
    }),
  )

  dual.instance("S1 calls per task are bounded: one repair, one more review, then the verdict stands", () =>
    Effect.gen(function* () {
      s1.calls = 0
      s1.down = false
      s1.flagged = new Set(Object.keys(SubagentReview.resultQuestions))
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      let prompts = 0
      const promptOps = stubOps({ onPrompt: () => void prompts++, text: "Looked around." })
      const result = yield* def.execute(brief, context(chat.id, assistant.id, promptOps))

      expect(prompts).toBe(2)
      // One brief review, one result review, one review after the repair.
      expect(s1.calls).toBe(3)
      expect(result.output).toContain(`<review decision="needs_revision" repaired="true">`)
      expect(result.output).toContain("re-delegate")
      expect(result.metadata).toMatchObject({
        review: { decision: "needs_revision", issues: expect.arrayContaining(["unmet_criterion"]), repaired: true },
      })
    }),
  )

  dual.instance("a change outside the scope needs revision without asking S1", () =>
    Effect.gen(function* () {
      s1.calls = 0
      s1.down = false
      s1.flagged = new Set()
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      let prompts = 0
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) =>
          Effect.sync(() => {
            prompts++
            return worked(input, DONE, [
              ["edit", { filePath: "src/db/pool.ts" }],
              ["bash", { command: "bun test test/cache" }, 0],
            ])
          }),
      }
      const result = yield* def.execute(brief, context(chat.id, assistant.id, promptOps))

      expect(prompts).toBe(2)
      // Only the brief review: a blocking finding settles each result review on its own.
      expect(s1.calls).toBe(1)
      expect(result.output).toContain(`<review decision="needs_revision" repaired="true">`)
      expect(result.output).toContain("src/db/pool.ts")
      expect(result.metadata).toMatchObject({ review: { decision: "needs_revision", issues: ["out_of_scope"] } })
    }),
  )

  dual.instance("single reasoning runs the mechanical checks only and labels the result unverified", () =>
    Effect.gen(function* () {
      const intelligence = yield* Intelligence.Service
      yield* intelligence.save({ settings: { ...(yield* intelligence.read()), reasoning: "single" } })
      s1.calls = 0
      s1.down = false
      s1.flagged = new Set(Object.keys(SubagentReview.resultQuestions))
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      let prompts = 0
      const result = yield* def.execute(
        brief,
        context(chat.id, assistant.id, stubOps({ onPrompt: () => void prompts++, text: "Looked around." })),
      )

      expect(s1.calls).toBe(0)
      expect(prompts).toBe(1)
      expect(result.output).toContain(`<review decision="unverified">`)
      expect(result.output).toContain(Intelligence.UNVERIFIED)
      expect(result.output).toContain("does not mention a done criterion")
      expect(result.metadata).toMatchObject({ review: { decision: "unverified", repaired: false } })
    }),
  )

  dual.instance("an S1 that fails leaves the result unverified, never verified", () =>
    Effect.gen(function* () {
      s1.down = true
      s1.flagged = new Set()
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      let prompts = 0
      const result = yield* def.execute(
        brief,
        context(chat.id, assistant.id, stubOps({ onPrompt: () => void prompts++, text: DONE })),
      )
      s1.down = false

      expect(prompts).toBe(1)
      expect(result.output).toContain(`<review decision="unverified">`)
      expect(result.output).toContain("S1 could not review the result")
      expect(result.output).toContain(DONE)
      expect(result.metadata).toMatchObject({ review: { decision: "unverified" } })
    }),
  )

  dual.instance("a task without a structured brief is not reviewed on the way out", () =>
    Effect.gen(function* () {
      s1.down = false
      s1.flagged = new Set()
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      const result = yield* def.execute(
        { description: "review", prompt: "review", subagent_type: "general" },
        context(chat.id, assistant.id, stubOps(), { bypassAgentCheck: true }),
      )

      expect(result.output).not.toContain("<review")
      expect(result.metadata).not.toHaveProperty("review")
    }),
  )

  dualBackground.instance("a background task reports its verdict when it finishes", () =>
    Effect.gen(function* () {
      s1.down = false
      s1.flagged = new Set()
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const def = yield* (yield* TaskTool).init()
      const injected = defer<SessionPrompt.PromptInput>()
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            injected.resolve(input)
            return Effect.succeed(reply(input, "noted"))
          }
          return Effect.succeed(
            worked(input, DONE, [
              ["edit", { filePath: "src/cache/key.ts" }],
              ["bash", { command: "bun test test/cache" }, 0],
            ]),
          )
        },
      }
      const started = yield* def.execute({ ...brief, background: true }, context(chat.id, assistant.id, promptOps))
      expect(started.output).toContain(`state="running"`)

      const waited = yield* jobs.wait({ id: started.metadata.sessionId, timeout: 1_000 })
      expect(waited.info?.status).toBe("completed")
      const notification = promptText(yield* Effect.promise(() => injected.promise))
      expect(notification).toContain("Background task completed")
      expect(notification).toContain(`<review decision="verified">`)
      expect(notification).toContain(DONE)
    }),
  )
})

const catalogModel = (
  name: string,
  extra: {
    family?: string
    reasoning?: boolean
    attachment?: boolean
    status?: "deprecated"
    cost?: { input: number; output: number }
    variants?: Record<string, Record<string, string>>
  } = {},
) => ({
  name,
  tool_call: true,
  release_date: "2025-01-01",
  limit: { context: 100_000, output: 10_000 },
  ...extra,
})

const catalogProvider = (name: string, models: Record<string, ReturnType<typeof catalogModel>>) => ({
  name,
  env: [],
  npm: "@ai-sdk/openai-compatible",
  options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
  models,
})

/** The parent runs on test/test-model, which has no variants; test-reason and acme-large have `high`. */
const catalog = {
  enabled_providers: ["test", "acme"],
  provider: {
    test: catalogProvider("Test", {
      "test-model": catalogModel("Test Model"),
      "test-reason": catalogModel("Test Reason", { reasoning: true, variants: { high: {} } }),
    }),
    acme: catalogProvider("Acme", {
      "acme-large": catalogModel("Acme Large", { reasoning: true, variants: { high: {} } }),
    }),
  },
  agent: {
    pinned: { description: "Pinned agent", mode: "subagent" as const, model: "acme/acme-large", variant: "high" },
  },
}

const quick = { description: "inspect bug", prompt: "look into the cache key path" }
const acme = { providerID: ProviderV2.ID.make("acme"), modelID: ModelV2.ID.make("acme-large") }
const reason = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-reason") }

describe("tool.task model", () => {
  it.instance(
    "a subagent runs on the parent's model and variant when neither the call nor its agent names one",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const def = yield* (yield* TaskTool).init()
        let seen: SessionPrompt.PromptInput | undefined
        const result = yield* def.execute(
          { ...quick, subagent_type: "general" },
          context(chat.id, assistant.id, stubOps({ onPrompt: (input) => (seen = input) })),
        )

        expect(seen?.model).toEqual(ref)
        expect(seen?.variant).toBe("xhigh")
        expect(result.metadata.model).toEqual(ref)
        expect(result.metadata.variant).toBe("xhigh")
        expect(result.metadata.modelSource).toBe("parent")
        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.model).toEqual({ id: ref.modelID, providerID: ref.providerID, variant: "xhigh" })
      }),
    { config: catalog },
  )

  it.instance(
    "an agent's configured model and variant win over the parent's",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const def = yield* (yield* TaskTool).init()
        let seen: SessionPrompt.PromptInput | undefined
        const result = yield* def.execute(
          { ...quick, subagent_type: "pinned" },
          context(chat.id, assistant.id, stubOps({ onPrompt: (input) => (seen = input) })),
        )

        expect(seen?.model).toEqual(acme)
        expect(seen?.variant).toBe("high")
        expect(result.metadata.modelSource).toBe("agent")
      }),
    { config: catalog },
  )

  it.instance(
    "a model the call names wins over the agent's, and its variant is checked against it",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const def = yield* (yield* TaskTool).init()
        let seen: SessionPrompt.PromptInput | undefined
        const result = yield* def.execute(
          { ...quick, subagent_type: "pinned", model: "test/test-reason", variant: "high" },
          context(chat.id, assistant.id, stubOps({ onPrompt: (input) => (seen = input) })),
        )

        expect(seen?.model).toEqual(reason)
        expect(seen?.variant).toBe("high")
        expect(result.metadata.model).toEqual(reason)
        expect(result.metadata.variant).toBe("high")
        expect(result.metadata.modelSource).toBe("explicit")
      }),
    { config: catalog },
  )

  it.instance(
    "an inherited variant the resolved model lacks is dropped",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const def = yield* (yield* TaskTool).init()
        let seen: SessionPrompt.PromptInput | undefined
        // The parent runs at xhigh, which acme-large does not have.
        const result = yield* def.execute(
          { ...quick, subagent_type: "general", model: "acme/acme-large" },
          context(chat.id, assistant.id, stubOps({ onPrompt: (input) => (seen = input) })),
        )

        expect(seen?.model).toEqual(acme)
        expect(seen?.variant).toBeUndefined()
        expect(result.metadata).not.toHaveProperty("variant")
      }),
    { config: catalog },
  )

  it.instance(
    "an unknown model fails with the closest matches and launches nothing",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const def = yield* (yield* TaskTool).init()
        let prompted = false
        const exit = yield* def
          .execute(
            { ...quick, subagent_type: "general", model: "test/test-modle" },
            context(chat.id, assistant.id, stubOps({ onPrompt: () => (prompted = true) })),
          )
          .pipe(Effect.exit)

        expect(failure(exit)).toContain(`Unknown model "test/test-modle"`)
        expect(failure(exit)).toContain("Close matches:")
        expect(failure(exit)).toContain("test/test-model")
        expect(failure(exit)).toContain("models tool")
        expect(prompted).toBe(false)
        expect(yield* sessions.children(chat.id)).toHaveLength(0)
      }),
    { config: catalog },
  )

  it.instance(
    "a variant the resolved model lacks fails with the ones it has",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const def = yield* (yield* TaskTool).init()
        const ctx = context(chat.id, assistant.id, stubOps())

        const wrong = yield* def
          .execute({ ...quick, subagent_type: "general", model: "test/test-reason", variant: "turbo" }, ctx)
          .pipe(Effect.exit)
        expect(failure(wrong)).toContain(`Variant "turbo" is not available for test/test-reason`)
        expect(failure(wrong)).toContain("high")

        const none = yield* def
          .execute({ ...quick, subagent_type: "general", model: "test/test-model", variant: "high" }, ctx)
          .pipe(Effect.exit)
        expect(failure(none)).toContain("test/test-model has no variants")
      }),
    { config: catalog },
  )

  dual.instance(
    "S1 flags a model the user did not ask for, and asks only when the brief names one",
    () =>
      Effect.gen(function* () {
        s1.calls = 0
        s1.down = false
        s1.flagged = new Set(["model_not_requested"])
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const def = yield* (yield* TaskTool).init()
        const ctx = context(chat.id, assistant.id, stubOps())

        const picked = yield* def.execute({ ...brief, model: "acme/acme-large" }, ctx).pipe(Effect.exit)
        expect(failure(picked)).toContain("needs revision")
        expect(failure(picked)).toContain("model_not_requested")
        expect(failure(picked)).toContain("Did the user ask for this model")
        expect(yield* sessions.children(chat.id)).toHaveLength(0)

        const plain = yield* def.execute(brief, ctx)
        expect(plain.metadata.brief?.verdict).toBe("verified")
        expect(plain.metadata.modelSource).toBe("parent")
      }),
    { config: catalog },
  )
})
