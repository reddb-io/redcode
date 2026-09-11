import { DesignStudio } from "../../src/design/studio"
import { DesignStore } from "@reddb-io/redcode-core/design/store"
import { SessionPlan } from "@reddb-io/redcode-core/session/plan"
import { ConfigV1 } from "@reddb-io/redcode-core/v1/config/config"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Database } from "@reddb-io/redcode-core/database/database"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { and, eq } from "drizzle-orm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Cause, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, Schema } from "effect"
import path from "path"
import { fileURLToPath } from "url"
import { NamedError } from "@reddb-io/redcode-core/util/error"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"

import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { SessionTodo } from "@reddb-io/redcode-core/session/todo"
import { Session } from "@/session/session"
import { SessionContextEpochTable, SessionInputTable, SessionMessageTable } from "@reddb-io/redcode-core/session/sql"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionContext } from "../../src/session/context"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionGuardLog } from "../../src/session/guard-log"
import { SessionGoal } from "../../src/session/goal"
import { GoalRuntime } from "../../src/session/goal-runtime"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionV2 } from "@reddb-io/redcode-core/session"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { SessionInput } from "@reddb-io/redcode-core/session/input"
import { SessionMessage } from "@reddb-io/redcode-core/session/message"
import { Prompt } from "@reddb-io/redcode-core/session/prompt"
import { SessionExecution } from "@reddb-io/redcode-core/session/execution"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { SystemContext } from "@reddb-io/redcode-core/system-context"
import { Shell } from "@reddb-io/redcode-core/shell"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { Ripgrep } from "@reddb-io/redcode-core/ripgrep"
import { Format } from "../../src/format"
import { InstanceState } from "@/effect/instance-state"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { LocationServiceMap, locationServiceMapLayer } from "@reddb-io/redcode-core/location-services"
import { Location } from "@reddb-io/redcode-core/location"
import { PluginV2 } from "@reddb-io/redcode-core/plugin"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { define, Operation } from "@reddb-io/redcode-plugin/v2/effect"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

function withSh<A, E, R>(fx: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.SHELL
      process.env.SHELL = "/bin/sh"
      Shell.preferred.reset()
      return prev
    }),
    () => fx(),
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env.SHELL
        else process.env.SHELL = prev
        Shell.preferred.reset()
      }),
  )
}

function toolPart(parts: SessionV1.Part[]) {
  return parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
}

type CompletedToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateCompleted }
type ErrorToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateError }

function completedTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("completed")
  return part?.state.status === "completed" ? (part as CompletedToolPart) : undefined
}

function errorTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("error")
  return part?.state.status === "error" ? (part as ErrorToolPart) : undefined
}

function makeMcp(instructions: MCP.ServerInstructions[] = [], failure?: string) {
  return Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      status: () => Effect.succeed({}),
      clients: () => Effect.succeed({}),
      instructions: () => (failure === undefined ? Effect.succeed(instructions) : Effect.die(new Error(failure))),
      tools: () => Effect.succeed({}),
      prompts: () => Effect.succeed({}),
      resources: () => Effect.succeed({}),
      resourceTemplates: () => Effect.succeed({}),
      add: () => Effect.succeed({ status: { status: "disabled" as const } }),
      connect: () => Effect.void,
      reload: () => Effect.succeed({}),
      disconnect: () => Effect.void,
      getPrompt: () => Effect.succeed(undefined),
      readResource: () => Effect.succeed(undefined),
      startAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      authenticate: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      finishAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      removeAuth: () => Effect.void,
      supportsOAuth: () => Effect.succeed(false),
      hasStoredTokens: () => Effect.succeed(false),
      getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    }),
  )
}

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const processorCreateStarted: Array<() => void> = []
const blockingProcessor = Layer.succeed(
  SessionProcessor.Service,
  SessionProcessor.Service.of({
    create: () => Effect.sync(() => processorCreateStarted.shift()?.()).pipe(Effect.andThen(Effect.never)),
  }),
)

const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true, experimentalBackgroundSubagents: true })

// No production Context Source returns unavailable, so a test-only source is appended to the
// legacy Baseline System Context here, outside the service: a test flips it between a value and
// `SystemContext.unavailable` to observe the epoch's replacement semantics at a boundary.
const flakySource = { value: "FLAKY SOURCE TEXT" as string | SystemContext.Unavailable }
const flakyContext = LayerNode.make({
  service: SessionContext.Service,
  layer: Layer.effect(
    SessionContext.Service,
    Effect.map(SessionContext.Service, (real) =>
      SessionContext.Service.of({
        load: (agent, session) =>
          real.load(agent, session).pipe(
            Effect.map((value) =>
              SystemContext.combine([
                value,
                SystemContext.make({
                  key: SystemContext.Key.make("test/flaky"),
                  codec: Schema.toCodecJson(Schema.String),
                  load: Effect.sync(() => flakySource.value),
                  baseline: (text) => text,
                  update: (_previous, text) => `The flaky source is now: ${text}`,
                }),
              ]),
            ),
          ),
      }),
    ),
  ).pipe(Layer.provide(SessionContext.layer)),
  deps: [
    Instruction.node,
    SystemPrompt.node,
    LayerNode.make({ service: LocationServiceMap.Service, layer: locationServiceMapLayer, deps: [] }),
  ],
})

const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const promptRoot = LayerNode.group([
  DesignStudio.node,
  SessionPlan.node,
  SessionPrompt.node,
  SessionGuardLog.node,
  GoalRuntime.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
  LocationServiceMap.node,
])

function makePrompt(input?: { mcpInstructions?: MCP.ServerInstructions[]; processor?: "blocking" }) {
  const replacements = [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp(input?.mcpInstructions)],
    [RuntimeFlags.node, runtimeFlags],
  ] as const
  if (input?.processor === "blocking") {
    return AppNodeBuilder.build(promptRoot, [...replacements, [SessionProcessor.node, blockingProcessor]])
  }
  return AppNodeBuilder.build(promptRoot, replacements)
}

function makeHttp(input?: {
  mcpInstructions?: MCP.ServerInstructions[]
  mcpFailure?: string
  processor?: "blocking"
  context?: typeof flakyContext
}) {
  const root = LayerNode.group([promptRoot, testLLMServerNode])
  const replacements = [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, makeMcp(input?.mcpInstructions, input?.mcpFailure)],
    [RuntimeFlags.node, runtimeFlags],
  ] as const
  if (input?.context) {
    return AppNodeBuilder.build(root, [...replacements, [SessionContext.node, input.context]])
  }
  if (input?.processor === "blocking") {
    return AppNodeBuilder.build(root, [...replacements, [SessionProcessor.node, blockingProcessor]])
  }
  return AppNodeBuilder.build(root, replacements)
}

function makeHttpNoLLMServer(input?: { mcpInstructions?: MCP.ServerInstructions[]; processor?: "blocking" }) {
  return makePrompt(input)
}

const it = testEffect(makeHttp())
const noLLMServer = testEffect(makeHttpNoLLMServer())
const raceNoLLMServer = testEffect(makeHttpNoLLMServer({ processor: "blocking" }))
const withMcpInstructions = testEffect(
  makeHttp({
    mcpInstructions: [
      {
        name: "guide-server",
        instructions: "Use lookup before mutate.",
        tools: ["guide-server_lookup"],
      },
    ],
  }),
)
const brokenMcp = testEffect(makeHttp({ mcpFailure: "mcp exploded" }))
const flaky = testEffect(makeHttp({ context: flakyContext }))
const unix = process.platform !== "win32" ? it.instance : it.instance.skip
const unixNoLLMServer = process.platform !== "win32" ? noLLMServer.instance : noLLMServer.instance.skip

// Config that registers a custom "test" provider with a "test-model" model
// so provider model lookup succeeds inside the loop.
const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(file, text)
})

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  yield* writeText(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("test.useServerConfig")(function* (config: (url: string) => Partial<ConfigV1.Info>) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

// Wait for a session's runner to enter a busy state. SessionStatus is flipped
// inside Runner.startShell's serialized transition, so cancel can't no-op once
// we observe it.
const waitForBusy = (sessionID: SessionID, duration: Duration.Input = "2 seconds") =>
  pollWithTimeout(
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      const s = yield* status.get(sessionID)
      return s.type === "busy" ? (true as const) : undefined
    }),
    `session ${sessionID} never became busy`,
    duration,
  )

const hasBash = Effect.sync(() => Bun.which("bash") !== null)

const deferredAsPromise = <A>(deferred: Deferred.Deferred<A>): PromiseLike<A> => ({
  then: (onfulfilled, onrejected) => {
    Effect.runFork(
      Deferred.await(deferred).pipe(
        Effect.match({
          onFailure: (error) => {
            onrejected?.(error)
          },
          onSuccess: (value) => {
            onfulfilled?.(value)
          },
        }),
      ),
    )
    return deferredAsPromise(deferred) as PromiseLike<never>
  },
})

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const succeedVoid = (deferred: Deferred.Deferred<void>) => {
  Effect.runSync(Deferred.succeed(deferred, void 0).pipe(Effect.ignore))
}

const user = Effect.fn("test.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const seed = Effect.fn("test.seed")(function* (sessionID: SessionID, opts?: { finish?: string }) {
  const session = yield* Session.Service
  const msg = yield* user(sessionID, "hello")
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: msg.id,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
    ...(opts?.finish ? { finish: opts.finish } : {}),
  }
  yield* session.updateMessage(assistant)
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "text",
    text: "hi there",
  })
  return { user: msg, assistant }
})

const addSubtask = (sessionID: SessionID, messageID: MessageID, model = ref) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    yield* session.updatePart({
      id: PartID.ascending(),
      messageID,
      sessionID,
      type: "subtask",
      prompt: "look into the cache key path",
      description: "inspect bug",
      agent: "general",
      model,
    })
  })

const boot = Effect.fn("test.boot")(function* (input?: { title?: string }) {
  const config = yield* Config.Service
  const prompt = yield* SessionPrompt.Service
  const run = yield* SessionRunState.Service
  const sessions = yield* Session.Service
  yield* config.get()
  const chat = yield* sessions.create(input ?? { title: "Pinned" })
  return { prompt, run, sessions, chat }
})

// Loop semantics

noLLMServer.instance(
  "loop exits immediately when last assistant has stop finish",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* seed(chat.id, { finish: "stop" })

      const result = yield* prompt.loop({ sessionID: chat.id })
      expect(result.info.role).toBe("assistant")
      if (result.info.role === "assistant") expect(result.info.finish).toBe("stop")
    }),
  { config: cfg },
)

it.instance("a prompt that names no agent continues the conversation's agent, not the default", () =>
  Effect.gen(function* () {
    // Injected messages — design feedback from the browser, orphan recovery, plugins — arrive
    // without an agent. They must not flip a plan or design session to build.
    yield* useServerConfig((url) => providerCfg(url))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Continuity" })

    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "plan",
      noReply: true,
      parts: [{ type: "text", text: "plan this" }],
    })
    yield* prompt.prompt({
      sessionID: chat.id,
      noReply: true,
      parts: [{ type: "text", text: "a note from the browser" }],
    })

    const users = (yield* sessions.messages({ sessionID: chat.id })).filter((m) => m.info.role === "user")
    expect(users.map((m) => (m.info.role === "user" ? m.info.agent : undefined))).toEqual(["plan", "plan"])

    // With no history at all, the default still applies.
    const fresh = yield* sessions.create({ title: "Fresh" })
    yield* prompt.prompt({ sessionID: fresh.id, noReply: true, parts: [{ type: "text", text: "hi" }] })
    const first = (yield* sessions.messages({ sessionID: fresh.id })).find((m) => m.info.role === "user")
    expect(first?.info.role === "user" ? first.info.agent : undefined).toBe("build")
  }),
)

it.instance(
  "asks for a report before the step ceiling instead of cutting the turn off at it",
  () =>
    Effect.gen(function* () {
      // The ceiling used to be a cliff: at the wall the turn was cut off and everything worked out
      // but not written down went with it, leaving the user told to "send another message" with
      // nothing to send it about.
      const { llm } = yield* useServerConfig((url) => ({
        ...providerCfg(url),
        experimental: { turn_steps: { stop_at: 3, wrap_up_at: 2 } },
      }))
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "keep going" }],
      })
      // Never finishing on its own: only the budget ends this turn.
      yield* llm.tool("todowrite", { todos: [{ content: "one", status: "in_progress", priority: "high" }] })
      yield* llm.tool("todowrite", { todos: [{ content: "two", status: "in_progress", priority: "high" }] })
      yield* llm.text("here is what I did and what is left")

      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the turn never finished", "30 seconds")

      const bodies = (yield* llm.hits).map((hit) => JSON.stringify(hit.body))
      // First step runs normally; the step before the wall carries the request for a final report.
      expect(bodies[0]).not.toContain("MAXIMUM STEPS REACHED")
      expect(bodies[1]).toContain("MAXIMUM STEPS REACHED")
    }),
  60_000,
)

it.instance("loop continues a natural stop while persisted todos are unfinished", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      agent: { build: { steps: 2 } },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const todos = yield* Todo.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "finish the task" }],
    })
    yield* todos.update({
      sessionID: chat.id,
      todos: [{ content: "verify the result", status: "pending", priority: "high" }],
    })
    yield* llm.text("premature")
    yield* llm.text("final")

    const result = yield* prompt.loop({ sessionID: chat.id })

    expect(yield* llm.calls).toBe(2)
    expect(JSON.stringify((yield* llm.hits)[0]?.body)).toContain("Complete only verified work")
    expect(JSON.stringify((yield* llm.hits)[1]?.body)).toContain("unfinished todo items")
    expect(result.parts).toContainEqual(expect.objectContaining({ type: "text", text: "final" }))
  }),
)

it.instance("todo state rides the last user message so a todowrite leaves the system prompt untouched", () =>
  Effect.gen(function* () {
    // The task list used to be rendered into the system prompt on every step. A todowrite then
    // rewrote the prompt's tail and the provider's cached prefix was lost for the request after it.
    // Three steps: the write, the request after it, and one todo continuation before the cap.
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      agent: { build: { steps: 3 } },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "track the work" }],
    })
    yield* llm.tool("todowrite", { todos: [{ content: "verify the result", status: "in_progress", priority: "high" }] })
    yield* llm.text("working")
    yield* llm.text("final")

    yield* prompt.loop({ sessionID: chat.id })

    const hits = yield* llm.hits
    expect(hits.length).toBe(3)
    const messagesOf = (hit: { body: Record<string, unknown> }) => {
      const list = hit.body.messages
      return Array.isArray(list) ? (list as Array<{ role: string; content: unknown }>) : []
    }
    const systemOf = (hit: { body: Record<string, unknown> }) =>
      messagesOf(hit)
        .filter((message) => message.role === "system")
        .map((message) => message.content)
    const before = systemOf(hits[0]!)
    expect(before.length).toBeGreaterThan(0)
    // The request after the todowrite sends the same system prompt, byte for byte.
    expect(systemOf(hits[1]!)).toEqual(before)
    expect(systemOf(hits[2]!)).toEqual(before)
    // The static guidance stays in the system prompt; the live state does not.
    expect(JSON.stringify(before)).toContain("Complete only verified work")
    expect(JSON.stringify(before)).not.toContain("No tracked tasks yet")
    // The list itself now travels with the last user message of that request.
    const lastUser = messagesOf(hits[1]!).findLast((message) => message.role === "user")
    expect(JSON.stringify(lastUser)).toContain("Current task state from storage: 0/1 completed")
    expect(JSON.stringify(lastUser)).toContain("verify the result")
    expect(JSON.stringify(messagesOf(hits[0]!).findLast((message) => message.role === "user"))).toContain(
      "No tracked tasks yet",
    )
  }),
)

it.instance("loop records a pause and preserves actionable tasks after seven unfinished continuations", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const todos = yield* Todo.Service
    const chat = yield* sessions.create({ title: "Unfinished work" })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "Finish" }],
    })
    yield* todos.update({ sessionID: chat.id, todos: [{ content: "Verify", status: "pending", priority: "high" }] })
    yield* Effect.forEach(Array.from({ length: 8 }), () => llm.text("More work remains"))
    yield* prompt.loop({ sessionID: chat.id })
    expect(yield* llm.calls).toBe(8)
    expect(yield* todos.get(chat.id)).toMatchObject([{ status: "in_progress" }])
    const guards = yield* SessionGuardLog.Service
    expect(yield* guards.recent()).toContainEqual(
      expect.objectContaining({ sessionID: chat.id, guard: "steps", action: "stop", subject: "task-continuation" }),
    )
  }),
)

it.instance("todowrite preserves omitted work and reports an invalid cancellation as a tool error", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({ ...providerCfg(url), agent: { build: { steps: 3 } } }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const todos = yield* Todo.Service
    const chat = yield* sessions.create({ title: "Preserve scope" })
    yield* todos.update({ sessionID: chat.id, todos: [{ content: "Keep", status: "pending", priority: "high" }] })
    yield* llm.tool("todowrite", { todos: [{ content: "Second", status: "pending", priority: "high" }] })
    yield* llm.tool("todowrite", { todos: [{ content: "Keep", status: "cancelled", priority: "high" }] })
    yield* llm.text("I will keep the requested work")
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      parts: [{ type: "text", text: "Keep all requested work" }],
    })
    expect((yield* todos.get(chat.id)).map((item) => item.content)).toEqual(["Keep", "Second"])
    expect((yield* todos.get(chat.id)).some((item) => item.status === "cancelled")).toBe(false)
    const parts = (yield* sessions.messages({ sessionID: chat.id })).flatMap((message) => message.parts)
    expect(
      parts.some(
        (part) =>
          part.type === "tool" &&
          part.state.status === "error" &&
          part.state.error.includes("requires a concrete reason"),
      ),
    ).toBe(true)
  }),
)

it.instance("todowrite rejects invented evidence and completes from a real tool result after resumption", () =>
  Effect.gen(function* () {
    const fixture = yield* useServerConfig((url) => ({ ...providerCfg(url), agent: { build: { steps: 3 } } }))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const todos = yield* Todo.Service
    const chat = yield* sessions.create({ title: "Verified task" })
    const file = path.join(fixture.dir, "report.txt")
    yield* Effect.promise(() => Bun.write(file, "Retries charge once"))
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "Inspect the report" }],
    })
    const task = (yield* todos.update({
      sessionID: chat.id,
      todos: [
        {
          content: "Inspect the report",
          criterion: "Report states retries charge once",
          requirement: "Inspect the report",
          status: "pending",
          priority: "high",
        },
      ],
    }))[0]
    const completion = {
      id: task.id,
      revision: task.revision,
      content: task.content,
      status: "completed",
      priority: "high",
    }
    yield* fixture.llm.tool("todowrite", {
      todos: [{ ...completion, evidence: { callID: "invented", explanation: "Verified" } }],
    })
    yield* fixture.llm.tool("read", { filePath: file })
    yield* fixture.llm.text("The report says retries charge once")
    yield* prompt.loop({ sessionID: chat.id })
    const parts = (yield* sessions.messages({ sessionID: chat.id })).flatMap((message) => message.parts)
    expect(
      parts.some(
        (part) =>
          part.type === "tool" &&
          part.tool === "todowrite" &&
          part.state.status === "error" &&
          part.state.error.includes("Completion requires evidence"),
      ),
    ).toBe(true)
    const proof = parts.find(
      (part) => part.type === "tool" && part.tool === "read" && part.state.status === "completed",
    )
    if (proof?.type !== "tool") throw new Error("Expected persisted read result")
    yield* fixture.llm.tool("todowrite", {
      todos: [
        {
          ...completion,
          evidence: {
            callID: proof.callID,
            messageID: proof.messageID,
            explanation: "Read report states retries charge once",
          },
        },
      ],
    })
    yield* fixture.llm.text("Verified and completed")
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      parts: [{ type: "text", text: "Continue and record the verification" }],
    })
    const completed = (yield* todos.get(chat.id))[0]
    expect(completed.status).toBe("completed")
    expect(completed.evidence?.callID).toBe(proof.callID)
    expect(completed.source?.quote).toBe("Inspect the report")
  }),
)

it.instance("loop does not continue unfinished todos when todowrite is denied", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const todos = yield* Todo.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "general",
      noReply: true,
      parts: [{ type: "text", text: "finish the task" }],
    })
    yield* todos.update({
      sessionID: chat.id,
      todos: [{ content: "blocked item", status: "pending", priority: "high" }],
    })
    yield* llm.text("done")

    yield* prompt.loop({ sessionID: chat.id })

    expect(yield* llm.calls).toBe(1)
    expect(JSON.stringify((yield* llm.hits)[0]?.body)).not.toContain("Complete only verified work")
  }),
)

noLLMServer.instance(
  "loop exits for a completed parent turn with nonmonotonic message IDs",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      const userID = MessageID.make("msg_z_user")
      const assistantID = MessageID.make("msg_a_assistant")
      yield* sessions.updateMessage({
        id: userID,
        role: "user",
        sessionID: chat.id,
        agent: "build",
        model: ref,
        time: { created: 100 },
      })
      yield* sessions.updateMessage({
        id: assistantID,
        role: "assistant",
        parentID: userID,
        sessionID: chat.id,
        mode: "build",
        agent: "build",
        cost: 0,
        path: { cwd: "/tmp", root: "/tmp" },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        time: { created: 200, completed: 201 },
        finish: "stop",
      })

      const result = yield* prompt.loop({ sessionID: chat.id })

      expect(result.info.id).toBe(assistantID)
    }),
  { config: cfg },
)

it.instance("loop exits without an LLM request for interrupted orphan tool calls", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const seeded = yield* seed(chat.id, { finish: "stop" })
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: seeded.assistant.id,
      sessionID: chat.id,
      type: "tool",
      callID: "interrupted-call",
      tool: "edit",
      state: {
        status: "error",
        input: {},
        error: "Tool execution aborted",
        metadata: { interrupted: true },
        time: { start: 1, end: 2 },
      },
    })

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.id).toBe(seeded.assistant.id)
    expect(yield* llm.hits).toHaveLength(0)
  }),
)

it.instance("loop calls LLM and returns assistant message", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.text("world")

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.role).toBe("assistant")
    const parts = result.parts.filter((p) => p.type === "text")
    expect(parts.some((p) => p.type === "text" && p.text === "world")).toBe(true)
    expect(yield* llm.hits).toHaveLength(1)
  }),
)

withMcpInstructions.instance(
  "loop includes MCP instructions in model system context",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(llm.wait(1), "timed out waiting for MCP instruction request", "10 seconds")

      const hits = yield* llm.hits
      const body = JSON.stringify(hits[0]?.body)
      expect(body).toContain('<server name=\\"guide-server\\">')
      expect(body).toContain("Use lookup before mutate.")
      yield* Fiber.interrupt(fiber)
    }),
  15_000,
)

it.instance("loop emits successful turn lifecycle events", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const lifecycle = new Array<{ type: string; finished?: boolean }>()
    const off = yield* events.listen((event) => {
      if (event.type === SessionEvent.Turn.Started.type) lifecycle.push({ type: event.type })
      if (event.type === SessionEvent.Turn.Ended.type)
        lifecycle.push({
          type: event.type,
          finished: (event.data as typeof SessionEvent.Turn.Ended.data.Type).finished,
        })
      return Effect.void
    })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.text("world")

    yield* prompt.loop({ sessionID: chat.id })
    yield* off

    expect(lifecycle).toEqual([
      { type: SessionEvent.Turn.Started.type },
      { type: SessionEvent.Turn.Ended.type, finished: true },
    ])
  }),
)

it.instance("runs Location-scoped V2 operation hooks", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const test = yield* TestInstance
    const locations = yield* LocationServiceMap.Service
    let started = 0
    const post = new Array<{ failed: boolean; command: unknown }>()
    const output = path.join(test.directory, "operation-hook.txt")
    yield* Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      yield* plugins.add(
        PluginV2.ID.make("prompt-operation-hooks"),
        define({
          id: "prompt-operation-hooks",
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.hook.parallel(Operation.Turn.Started, () => {
                started += 1
              })
              yield* ctx.hook.waterfall(Operation.Agent.PreSystem, (event, next) =>
                next({ ...event.data, system: [...event.data.system, "V2 operation hook marker"] }),
              )
              yield* ctx.hook.waterfall(Operation.Tool.PreExecute, (event, next) =>
                next({
                  ...event.data,
                  args: { ...event.data.args, command: `printf hook > ${JSON.stringify(output)}` },
                }),
              )
              yield* ctx.hook.parallel(Operation.Tool.PostExecute, (event) => {
                post.push({ failed: event.data.failed, command: event.data.args.command })
              })
            }),
        }).effect,
      )
    }).pipe(
      Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(test.directory) }))),
      Effect.orDie,
    )

    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.toolMatch((hit) => JSON.stringify(hit.body).includes("hello"), "bash", { command: "printf wrong" })
    yield* llm.text("world")

    yield* prompt.loop({ sessionID: chat.id })

    expect(started).toBe(1)
    expect(JSON.stringify((yield* llm.hits)[0]?.body)).toContain("V2 operation hook marker")
    expect(yield* Effect.promise(() => Bun.file(output).text())).toBe("hook")
    expect(post).toEqual([{ failed: false, command: `printf hook > ${JSON.stringify(output)}` }])
  }),
)

it.instance("loop emits interrupted turn lifecycle events", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const lifecycle = new Array<{ type: string; finished?: boolean }>()
    const off = yield* events.listen((event) => {
      if (event.type === SessionEvent.Turn.Started.type) lifecycle.push({ type: event.type })
      if (event.type === SessionEvent.Turn.Ended.type)
        lifecycle.push({
          type: event.type,
          finished: (event.data as typeof SessionEvent.Turn.Ended.data.Type).finished,
        })
      return Effect.void
    })
    yield* llm.hang
    yield* user(chat.id, "hello")
    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* awaitWithTimeout(llm.wait(1), "timed out waiting for turn request", "10 seconds")

    yield* prompt.cancel(chat.id)
    yield* Fiber.await(fiber)
    yield* off

    expect(lifecycle).toEqual([
      { type: SessionEvent.Turn.Started.type },
      { type: SessionEvent.Turn.Ended.type, finished: false },
    ])
  }),
)

it.instance("legacy prompt emits message events and only prompt admission from session.next", () =>
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Pinned",
      agent: "plan",
      model: { providerID: ProviderV2.ID.make("old"), id: ModelV2.ID.make("old-model") },
    })
    const seen: string[] = []
    const off = yield* events.listen((event) => {
      seen.push(event.type)
      return Effect.void
    })

    const first = yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    const second = yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "again" }],
    })
    yield* off

    expect(first.info.role).toBe("user")
    expect(second.info.role).toBe("user")
    if (first.info.role === "user" && second.info.role === "user") {
      expect(first.info.model).toEqual(ref)
      expect(second.info.model).toEqual(ref)
    }
    expect(yield* sessions.get(chat.id)).toMatchObject({
      agent: "build",
      model: { providerID: ref.providerID, id: ref.modelID },
    })
    expect(seen).toContain(Session.Event.Updated.type)
    expect(seen).toContain(MessageV2.Event.Updated.type)
    expect(seen).toContain(MessageV2.Event.PartUpdated.type)
    // The inbox row is a sidecar next to the V1 message: admission is durable, but nothing
    // projects a V2 user row for a legacy session.
    expect(seen.filter((type) => type.startsWith("session.next."))).toEqual([
      SessionEvent.PromptAdmitted.type,
      SessionEvent.PromptAdmitted.type,
    ])
  }),
)

it.instance("loop surfaces content-filter finishes as session errors", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    const errors: NonNullable<SessionV1.Assistant["error"]>[] = []
    const expected = {
      name: "ContentFilterError",
      data: { message: "The response was blocked by the provider's content filter" },
    } satisfies NonNullable<SessionV1.Assistant["error"]>
    const off = yield* events.listen((event) => {
      if (event.type !== Session.Event.Error.type) return Effect.void
      const data = event.data as typeof Session.Event.Error.data.Type
      if (data.sessionID === chat.id && data.error) errors.push(data.error)
      return Effect.void
    })

    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.push(reply().text("partial response").contentFilter())

    const result = yield* prompt.loop({ sessionID: chat.id })
    const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: result.info.id })
    yield* off

    expect(yield* llm.hits).toHaveLength(1)
    expect(result.info.role).toBe("assistant")
    expect(stored.info.role).toBe("assistant")
    if (result.info.role === "assistant" && stored.info.role === "assistant") {
      expect(result.info.finish).toBe("content-filter")
      expect(result.info.error).toEqual(expected)
      expect(stored.info.error).toEqual(result.info.error)
      expect(errors).toContainEqual(expected)
    }
    expect(result.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "partial response" })]),
    )
  }),
)

it.instance("loop stops provider overflow instead of auto-compacting when disabled", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      compaction: { auto: false },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.error(413, { error: { message: "request entity too large" } })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })

    const result = yield* prompt.loop({ sessionID: chat.id })
    const messages = yield* sessions.messages({ sessionID: chat.id })

    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.info.error?.name).toBe("ContextOverflowError")
      expect(result.info.finish).toBe("error")
    }
    expect(messages.some((message) => message.parts.some((part) => part.type === "compaction"))).toBe(false)
  }),
)

noLLMServer.instance.skip(
  "prompt emits v2 prompted and synthetic events (v2 projector disabled)",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [
          { type: "text", text: "hello v2" },
          {
            type: "file",
            mime: "text/plain",
            filename: "note.txt",
            url: "data:text/plain;base64,bm90ZSBjb250ZW50",
          },
        ],
      })

      const messages = yield* SessionV2.Service.use((session) => session.messages({ sessionID: chat.id })).pipe(
        Effect.provide(
          LayerNode.compile(SessionV2.node, [
            [SessionExecution.node, SessionExecution.noopLayer],
            [LocationServiceMap.node, locationServiceMapLayer],
          ]),
        ),
      )
      const { db } = yield* Database.Service
      const row = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, chat.id))
        .get()
        .pipe(Effect.orDie)
      expect(messages.find((message) => message.type === "user")).toMatchObject({ type: "user", text: "hello v2" })
      expect(typeof row?.data.time.created).toBe("number")
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "synthetic", text: expect.stringContaining("Called the Read tool") }),
          expect.objectContaining({ type: "synthetic", text: "note content" }),
        ]),
      )
    }),
  { config: cfg },
)

it.instance("static loop returns assistant text through local provider", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Prompt provider",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })

    yield* llm.text("world")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(result.info.role).toBe("assistant")
    expect(result.parts.some((part) => part.type === "text" && part.text === "world")).toBe(true)
    expect(yield* llm.hits).toHaveLength(1)
    expect(yield* llm.pending).toBe(0)
  }),
)

it.instance("static loop consumes queued replies across turns", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Prompt provider turns",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello one" }],
    })

    yield* llm.text("world one")

    const first = yield* prompt.loop({ sessionID: session.id })
    expect(first.info.role).toBe("assistant")
    expect(first.parts.some((part) => part.type === "text" && part.text === "world one")).toBe(true)

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello two" }],
    })

    yield* llm.text("world two")

    const second = yield* prompt.loop({ sessionID: session.id })
    expect(second.info.role).toBe("assistant")
    expect(second.parts.some((part) => part.type === "text" && part.text === "world two")).toBe(true)

    expect(yield* llm.hits).toHaveLength(2)
    expect(yield* llm.pending).toBe(0)
  }),
)

// Holds a session's first turn open inside its Turn.Ended hook: after the loop's last look at
// history, before the runner goes idle. A prompt sent in that window used to be persisted but
// never answered.
const holdFirstTurnEnd = Effect.fn("test.holdFirstTurnEnd")(function* (id: string) {
  const test = yield* TestInstance
  const locations = yield* LocationServiceMap.Service
  const reached = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  let ended = 0
  yield* Effect.gen(function* () {
    const plugins = yield* PluginV2.Service
    yield* plugins.add(
      PluginV2.ID.make(id),
      define({
        id,
        effect: (ctx) =>
          ctx.hook
            .parallel(Operation.Turn.Ended, () =>
              Effect.gen(function* () {
                ended += 1
                if (ended > 1) return
                yield* Deferred.succeed(reached, void 0)
                yield* Deferred.await(release)
              }),
            )
            .pipe(Effect.asVoid),
      }).effect,
    )
  }).pipe(
    Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(test.directory) }))),
    Effect.orDie,
  )
  return { reached, release, ended: () => ended }
})

const secondUserPersisted = (sessionID: SessionID) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const msgs = yield* MessageV2.filterCompactedEffect(sessionID)
      return msgs.filter((msg) => msg.info.role === "user").length === 2 ? (true as const) : undefined
    }),
    "second prompt never persisted its user message",
  ).pipe(
    // The user message is durable before the prompt reaches the runner; give it that last step.
    Effect.andThen(Effect.sleep("200 millis")),
  )

it.instance("answers a prompt that lands while the previous turn is finishing", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const hold = yield* holdFirstTurnEnd("drain-boundary-prompt")
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const chat = yield* sessions.create({ title: "Drain boundary" })
    yield* llm.text("world one")
    yield* llm.text("world two")

    const first = yield* prompt
      .prompt({ sessionID: chat.id, agent: "build", parts: [{ type: "text", text: "hello one" }] })
      .pipe(Effect.forkChild)
    yield* awaitWithTimeout(Deferred.await(hold.reached), "first turn never started ending", "10 seconds")

    const second = yield* prompt
      .prompt({ sessionID: chat.id, agent: "build", parts: [{ type: "text", text: "hello two" }] })
      .pipe(Effect.forkChild)
    yield* secondUserPersisted(chat.id)
    yield* Deferred.succeed(hold.release, void 0)

    const one = yield* awaitWithTimeout(Fiber.join(first), "first prompt never resolved", "10 seconds")
    const two = yield* awaitWithTimeout(Fiber.join(second), "second prompt never resolved", "10 seconds")
    expect(one.parts.some((part) => part.type === "text" && part.text === "world one")).toBe(true)
    expect(two.parts.some((part) => part.type === "text" && part.text === "world two")).toBe(true)

    const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
    const { user: lastUser, assistant: lastAssistant } = MessageV2.latest(msgs)
    expect(msgs.at(-1)?.info.role).toBe("assistant")
    expect(lastAssistant?.parentID).toBe(lastUser?.id)
    expect(lastAssistant?.finish).toBe("stop")
    expect(hold.ended()).toBe(2)
    expect((yield* status.get(chat.id)).type).toBe("idle")
    expect(yield* llm.pending).toBe(0)
  }),
)

it.instance("cancel while a turn is finishing does not start another run", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const hold = yield* holdFirstTurnEnd("drain-boundary-cancel")
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const runState = yield* SessionRunState.Service
    const chat = yield* sessions.create({ title: "Drain boundary cancel" })
    yield* llm.text("world one")
    yield* llm.text("world two")

    const first = yield* prompt
      .prompt({ sessionID: chat.id, agent: "build", parts: [{ type: "text", text: "hello one" }] })
      .pipe(Effect.forkChild)
    yield* awaitWithTimeout(Deferred.await(hold.reached), "first turn never started ending", "10 seconds")

    const second = yield* prompt
      .prompt({ sessionID: chat.id, agent: "build", parts: [{ type: "text", text: "hello two" }] })
      .pipe(Effect.forkChild)
    yield* secondUserPersisted(chat.id)

    // Turn.Ended runs as a finalizer, so the interrupt only lands once the hook lets go; the
    // runner leaves its running state as soon as cancel is admitted, which is what we wait for.
    const cancel = yield* prompt.cancel(chat.id).pipe(Effect.forkChild)
    yield* pollWithTimeout(
      runState.assertNotBusy(chat.id).pipe(
        Effect.as(true as const),
        Effect.orElseSucceed(() => undefined),
      ),
      "cancel never left the running state",
    )
    yield* Deferred.succeed(hold.release, void 0)
    yield* awaitWithTimeout(Fiber.join(cancel), "cancel never finished", "10 seconds")

    const one = yield* awaitWithTimeout(Fiber.join(first), "first prompt never resolved", "10 seconds")
    const two = yield* awaitWithTimeout(Fiber.join(second), "second prompt never resolved", "10 seconds")
    expect(one.info.role).toBe("assistant")
    expect(two.info.role).toBe("assistant")

    yield* Effect.sleep("200 millis")
    expect(hold.ended()).toBe(1)
    expect((yield* status.get(chat.id)).type).toBe("idle")
    expect(yield* llm.pending).toBe(1)
    const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
    const { user: lastUser, assistant: lastAssistant } = MessageV2.latest(msgs)
    expect(lastAssistant?.parentID).not.toBe(lastUser?.id)
  }),
)

// The inbox row an accepted prompt leaves next to its V1 message rows.
const admittedRow = (id: MessageID) =>
  Database.Service.use(({ db }) => SessionInput.find(db, SessionMessage.ID.make(id)))

const messagesOf = (hit: { body: Record<string, unknown> }) =>
  Array.isArray(hit.body.messages) ? (hit.body.messages as Array<{ role: string; content: unknown }>) : []

const toolRunning = (sessionID: SessionID) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const msgs = yield* MessageV2.filterCompactedEffect(sessionID)
      const assistant = msgs.findLast((msg) => msg.info.role === "assistant")
      const tool = assistant ? toolPart(assistant.parts) : undefined
      return tool?.state.status === "running" ? (true as const) : undefined
    }),
    "the held tool never started",
    "10 seconds",
  )

const heldTool = (dir: string) => {
  const flag = path.join(dir, "release-tool")
  return {
    input: {
      command: `until [ -e "${flag}" ]; do sleep 0.05; done; echo released`,
      timeout: 30_000,
      workdir: path.resolve(dir),
    },
    release: Effect.promise(() => Bun.write(flag, "go")),
  }
}

unix(
  "a steer admitted while a tool is held lands in the next provider request",
  () =>
    Effect.gen(function* () {
      if (!(yield* hasBash)) return
      const { dir, llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Steer",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      const held = heldTool(dir)
      yield* llm.tool("bash", held.input)
      yield* llm.text("after the tool")

      const first = yield* prompt
        .prompt({ sessionID: chat.id, agent: "build", model: ref, parts: [{ type: "text", text: "run the tool" }] })
        .pipe(Effect.forkChild)
      yield* llm.wait(1)
      yield* waitForBusy(chat.id)
      yield* toolRunning(chat.id)

      const id = MessageID.ascending()
      const second = yield* prompt
        .prompt({
          sessionID: chat.id,
          messageID: id,
          agent: "build",
          model: ref,
          parts: [{ type: "text", text: "and also this" }],
        })
        .pipe(Effect.forkChild)
      yield* pollWithTimeout(
        admittedRow(id).pipe(Effect.map((row) => (row ? (true as const) : undefined))),
        "second prompt never admitted",
      )
      // Stored for the TUI and admitted, but the running step is left alone.
      expect((yield* admittedRow(id))?.promotedSeq).toBeUndefined()
      expect((yield* sessions.messages({ sessionID: chat.id })).some((msg) => msg.info.id === id)).toBe(true)
      expect(yield* llm.calls).toBe(1)

      yield* held.release
      const one = yield* awaitWithTimeout(Fiber.join(first), "first prompt never resolved", "20 seconds")
      const two = yield* awaitWithTimeout(Fiber.join(second), "second prompt never resolved", "20 seconds")
      expect(one.parts.some((part) => part.type === "text" && part.text === "after the tool")).toBe(true)
      expect(two.info.id).toBe(one.info.id)

      // The steer became visible at the boundary after the tool: the tool-result request is the
      // first one that carries it, as its last user message.
      const hits = yield* llm.hits
      expect(hits).toHaveLength(2)
      expect(JSON.stringify(messagesOf(hits[0]!))).not.toContain("and also this")
      expect(messagesOf(hits[1]!).at(-1)?.role).toBe("user")
      expect(JSON.stringify(messagesOf(hits[1]!).at(-1))).toContain("and also this")
      const row = yield* admittedRow(id)
      expect(row?.delivery).toBe("steer")
      expect(row?.promotedSeq).toBeGreaterThan(row?.admittedSeq ?? Infinity)
      expect(one.info.role === "assistant" && one.info.parentID).toBe(id)
      expect(yield* llm.pending).toBe(0)
    }),
  30_000,
)

unix(
  "queued prompts wait for the turn to end, then are promoted one at a time in admission order",
  () =>
    Effect.gen(function* () {
      if (!(yield* hasBash)) return
      const { dir, llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Queue",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      const held = heldTool(dir)
      yield* llm.tool("bash", held.input)
      yield* llm.text("first done")
      yield* llm.text("second done")
      yield* llm.text("third done")

      const run = yield* prompt
        .prompt({ sessionID: chat.id, agent: "build", model: ref, parts: [{ type: "text", text: "run the tool" }] })
        .pipe(Effect.forkChild)
      yield* llm.wait(1)
      yield* waitForBusy(chat.id)
      yield* toolRunning(chat.id)

      const alpha = MessageID.ascending()
      const beta = MessageID.ascending()
      yield* prompt.prompt({
        sessionID: chat.id,
        messageID: alpha,
        agent: "build",
        model: ref,
        noReply: true,
        delivery: "queue",
        parts: [{ type: "text", text: "alpha-queued-prompt" }],
      })
      yield* prompt.prompt({
        sessionID: chat.id,
        messageID: beta,
        agent: "build",
        model: ref,
        noReply: true,
        delivery: "queue",
        parts: [{ type: "text", text: "beta-queued-prompt" }],
      })
      expect((yield* admittedRow(alpha))?.promotedSeq).toBeUndefined()
      expect((yield* admittedRow(beta))?.promotedSeq).toBeUndefined()

      yield* held.release
      const last = yield* awaitWithTimeout(Fiber.join(run), "the drain never finished", "20 seconds")
      expect(last.parts.some((part) => part.type === "text" && part.text === "third done")).toBe(true)
      expect(last.info.role === "assistant" && last.info.parentID).toBe(beta)

      const hits = yield* llm.hits
      expect(hits).toHaveLength(4)
      // The tool-result request carries no queued prompt: the turn still required continuation.
      expect(JSON.stringify(messagesOf(hits[1]!))).not.toContain("-queued-prompt")
      // Once the turn would have ended, exactly one queued prompt at a time, oldest first.
      expect(JSON.stringify(messagesOf(hits[2]!))).toContain("alpha-queued-prompt")
      expect(JSON.stringify(messagesOf(hits[2]!))).not.toContain("beta-queued-prompt")
      expect(JSON.stringify(messagesOf(hits[3]!))).toContain("beta-queued-prompt")
      const one = yield* admittedRow(alpha)
      const two = yield* admittedRow(beta)
      expect(one?.admittedSeq ?? Infinity).toBeLessThan(two?.admittedSeq ?? -Infinity)
      expect(one?.promotedSeq ?? Infinity).toBeLessThan(two?.promotedSeq ?? -Infinity)
      expect(yield* llm.pending).toBe(0)
    }),
  30_000,
)

it.instance("noReply admits the prompt without answering it", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const chat = yield* sessions.create({ title: "Admit only" })

    const id = MessageID.ascending()
    const message = yield* prompt.prompt({
      sessionID: chat.id,
      messageID: id,
      agent: "build",
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "later" }],
    })
    expect(message.info.role).toBe("user")

    const row = yield* admittedRow(id)
    expect(row?.delivery).toBe("steer")
    expect(row?.prompt.text).toBe("later")
    expect(row?.promotedSeq).toBeUndefined()
    // Stored for the surfaces, nothing sent to the model.
    expect((yield* sessions.messages({ sessionID: chat.id })).some((msg) => msg.info.id === id)).toBe(true)
    expect(yield* llm.calls).toBe(0)
    expect((yield* status.get(chat.id)).type).toBe("idle")
  }),
)

it.instance("a retried publication of a pending message promotes nothing and stays hidden", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Retry" })

    const queued = MessageID.ascending()
    const stored = yield* prompt.prompt({
      sessionID: chat.id,
      messageID: queued,
      agent: "build",
      model: ref,
      noReply: true,
      delivery: "queue",
      parts: [{ type: "text", text: "queued-later" }],
    })
    // The same message published again — what an idempotent retry does — is not a promotion.
    yield* sessions.updateMessage(stored.info)
    expect((yield* admittedRow(queued))?.promotedSeq).toBeUndefined()

    yield* llm.text("hello answered")
    yield* llm.text("queued answered")
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", model: ref, parts: [{ type: "text", text: "hello" }] })

    const hits = yield* llm.hits
    expect(hits).toHaveLength(2)
    expect(JSON.stringify(messagesOf(hits[0]!))).not.toContain("queued-later")
    expect(JSON.stringify(messagesOf(hits[1]!))).toContain("queued-later")
    expect((yield* admittedRow(queued))?.promotedSeq).toBeDefined()
  }),
)

it.instance("an orphan queue head is discarded and the next queued prompt is promoted", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Orphan" })

    // Admission committed, then the process died before the message rows were written — long
    // enough ago that this is not a row whose rows are still on their way.
    const orphan = MessageID.ascending()
    yield* SessionInput.admit(db, events, {
      id: SessionMessage.ID.make(orphan),
      sessionID: chat.id,
      prompt: Prompt.fromUserMessage({ text: "never stored" }),
      delivery: "queue",
    })
    yield* db
      .update(SessionInputTable)
      .set({ time_created: Date.now() - 60_000 })
      .where(eq(SessionInputTable.id, SessionMessage.ID.make(orphan)))
      .run()
      .pipe(Effect.orDie)
    const real = MessageID.ascending()
    yield* prompt.prompt({
      sessionID: chat.id,
      messageID: real,
      agent: "build",
      model: ref,
      noReply: true,
      delivery: "queue",
      parts: [{ type: "text", text: "real-queued-prompt" }],
    })

    yield* llm.text("hello answered")
    yield* llm.text("queued answered")
    const last = yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      model: ref,
      parts: [{ type: "text", text: "hello" }],
    })
    expect(last.info.role === "assistant" && last.info.parentID).toBe(real)
    expect(JSON.stringify(messagesOf((yield* llm.hits)[1]!))).toContain("real-queued-prompt")
    expect(yield* admittedRow(orphan)).toBeUndefined()
    expect((yield* admittedRow(real))?.promotedSeq).toBeDefined()
  }),
)

it.instance("a boundary between admission and the message rows leaves the prompt admitted", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Admission race" })
    yield* seed(chat.id, { finish: "stop" })

    // Admission is committed; the message rows are a separate publication that has not landed.
    const id = MessageID.ascending()
    yield* SessionInput.admit(db, events, {
      id: SessionMessage.ID.make(id),
      sessionID: chat.id,
      prompt: Prompt.fromUserMessage({ text: "rows on their way" }),
      delivery: "steer",
    })
    // A boundary in between: the row is young, so it is neither promoted nor discarded.
    const idle = yield* awaitWithTimeout(
      prompt.loop({ sessionID: chat.id }),
      "the idle loop never finished",
      "20 seconds",
    )
    expect(idle.info.role).toBe("assistant")
    expect(yield* llm.calls).toBe(0)
    expect((yield* admittedRow(id))?.promotedSeq).toBeUndefined()

    yield* sessions.updateMessage({
      id,
      role: "user",
      sessionID: chat.id,
      agent: "build",
      model: ref,
      time: { created: Date.now() },
    })
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: id,
      sessionID: chat.id,
      type: "text",
      text: "rows on their way",
    })
    yield* llm.text("answered after the rows landed")
    const result = yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the loop never finished", "20 seconds")
    expect(result.info.role === "assistant" && result.info.parentID).toBe(id)
    expect((yield* admittedRow(id))?.promotedSeq).toBeDefined()
    expect(JSON.stringify(messagesOf((yield* llm.hits)[0]!))).toContain("rows on their way")
  }),
)

it.instance("promotion is recorded as a durable message.promoted event", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Promotion event" })
    const seen: Array<{ type: string; seq: number | undefined }> = []
    const off = yield* events.listen((event) => {
      if (event.type === SessionV1.Event.MessagePromoted.type || event.type === SessionEvent.PromptAdmitted.type)
        seen.push({ type: event.type, seq: event.durable?.seq })
      return Effect.void
    })
    yield* llm.text("hi")
    const id = MessageID.ascending()
    yield* prompt.prompt({
      sessionID: chat.id,
      messageID: id,
      agent: "build",
      model: ref,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* off
    const row = yield* admittedRow(id)
    expect(seen.map((event) => event.type)).toEqual([
      SessionEvent.PromptAdmitted.type,
      SessionV1.Event.MessagePromoted.type,
    ])
    expect(seen[0]?.seq).toBe(row?.admittedSeq)
    expect(seen[1]?.seq).toBe(row?.promotedSeq)
  }),
)

it.instance("a queued prompt on an idle session with an active goal is promoted before any judging", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const goals = yield* GoalRuntime.Service
    const chat = yield* sessions.create({ title: "Goal idle" })
    yield* goals.set(chat.id, SessionGoal.parse("Ship the feature"))
    // The previous turn is finished and was judged by the drain that ran it.
    yield* seed(chat.id, { finish: "stop" })

    const queued = MessageID.ascending()
    yield* prompt.prompt({
      sessionID: chat.id,
      messageID: queued,
      agent: "build",
      model: ref,
      noReply: true,
      delivery: "queue",
      parts: [{ type: "text", text: "queued-goal-prompt" }],
    })
    yield* llm.text("worked on it")
    // A verdict that ends the turn without a continuation or an evidence check.
    yield* llm.textMatch(judgeRequest, verdict("blocked", "needs the maintainer's decision"))
    yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the loop never finished", "20 seconds")

    const hits = yield* llm.hits
    // No judge call before the queued prompt's own turn; exactly one after it.
    expect(judgeRequest(hits[0]!)).toBe(false)
    expect(JSON.stringify(messagesOf(hits[0]!))).toContain("queued-goal-prompt")
    expect(hits.filter(judgeRequest)).toHaveLength(1)
    expect(hits.findIndex(judgeRequest)).toBeGreaterThan(0)
    expect((yield* goals.get(chat.id))?.status).toBe("blocked")
  }),
)

it.instance(
  "a promoted prompt starts the todo continuation budget over",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Continuations" })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        noReply: true,
        parts: [{ type: "text", text: "start" }],
      })
      const queued = MessageID.ascending()
      yield* prompt.prompt({
        sessionID: chat.id,
        messageID: queued,
        agent: "build",
        model: ref,
        noReply: true,
        delivery: "queue",
        parts: [{ type: "text", text: "queued-after-limit" }],
      })

      yield* llm.tool("todowrite", { todos: [{ content: "one", status: "in_progress", priority: "high" }] })
      // Seven continuations exhaust the first turn's budget; the eighth natural stop ends it.
      for (let i = 0; i < 8; i++) yield* llm.text(`still working ${i}`)
      yield* llm.text("queued answered")
      // Reset by the promotion, the reminder gets a full budget of seven again.
      for (let i = 0; i < 7; i++) yield* llm.text(`still working again ${i}`)

      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the loop never finished", "30 seconds")

      const hits = yield* llm.hits
      const reminders = hits.map((hit) => JSON.stringify(messagesOf(hit).at(-1)).includes("unfinished todo items"))
      expect(hits).toHaveLength(17)
      expect(reminders.slice(2, 9)).toEqual(Array(7).fill(true))
      expect(JSON.stringify(messagesOf(hits[9]!))).toContain("queued-after-limit")
      expect(reminders.slice(10)).toEqual(Array(7).fill(true))
      expect(yield* llm.pending).toBe(0)
    }),
  60_000,
)

it.instance(
  "a turn stopped at the step ceiling still promotes a queued prompt",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => ({
        ...providerCfg(url),
        experimental: { turn_steps: { stop_at: 3, wrap_up_at: 2 } },
      }))
      const events = yield* EventV2Bridge.Service
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Ceiling" })
      let errors = 0
      const off = yield* events.listen((event) => {
        if (event.type === Session.Event.Error.type) errors += 1
        return Effect.void
      })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        noReply: true,
        parts: [{ type: "text", text: "keep going" }],
      })
      const queued = MessageID.ascending()
      yield* prompt.prompt({
        sessionID: chat.id,
        messageID: queued,
        agent: "build",
        model: ref,
        noReply: true,
        delivery: "queue",
        parts: [{ type: "text", text: "queued-after-ceiling" }],
      })
      // Never finishing on its own: only the ceiling ends the first turn.
      yield* llm.tool("todowrite", { todos: [{ content: "one", status: "completed", priority: "high" }] })
      yield* llm.tool("todowrite", { todos: [{ content: "two", status: "completed", priority: "high" }] })
      yield* llm.text("queued answered")

      const last = yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the loop never finished", "30 seconds")
      yield* off
      expect(errors).toBe(1)
      expect(last.info.role === "assistant" && last.info.parentID).toBe(queued)
      const hits = yield* llm.hits
      expect(hits).toHaveLength(3)
      expect(JSON.stringify(messagesOf(hits[1]!))).not.toContain("queued-after-ceiling")
      expect(JSON.stringify(messagesOf(hits[2]!))).toContain("queued-after-ceiling")
    }),
  60_000,
)

unix(
  "steers admitted during a step are promoted together in admission order with one step reset",
  () =>
    Effect.gen(function* () {
      if (!(yield* hasBash)) return
      const { dir, llm } = yield* useServerConfig(providerCfg)
      const events = yield* EventV2Bridge.Service
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Steer batch",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      const steps: number[] = []
      const off = yield* events.listen((event) => {
        if (event.type !== SessionStatus.Event.Status.type) return Effect.void
        const status = (event.data as { status: SessionStatus.Info }).status
        if (status.type === "busy" && status.phase === "preparing" && status.step !== undefined) steps.push(status.step)
        return Effect.void
      })
      const held = heldTool(dir)
      yield* llm.tool("bash", held.input)
      yield* llm.tool("bash", { command: "echo two", timeout: 30_000, workdir: path.resolve(dir) })
      yield* llm.text("all answered")

      const run = yield* prompt
        .prompt({ sessionID: chat.id, agent: "build", model: ref, parts: [{ type: "text", text: "run the tool" }] })
        .pipe(Effect.forkChild)
      yield* llm.wait(1)
      yield* waitForBusy(chat.id)
      yield* toolRunning(chat.id)

      const first = MessageID.ascending()
      const second = MessageID.ascending()
      for (const [id, text] of [
        [first, "steer-first"],
        [second, "steer-second"],
      ] as const) {
        yield* prompt.prompt({
          sessionID: chat.id,
          messageID: id,
          agent: "build",
          model: ref,
          noReply: true,
          parts: [{ type: "text", text }],
        })
      }
      yield* held.release
      yield* awaitWithTimeout(Fiber.join(run), "the drain never finished", "20 seconds")
      yield* off

      const hits = yield* llm.hits
      expect(hits).toHaveLength(3)
      const body = JSON.stringify(messagesOf(hits[1]!))
      expect(JSON.stringify(messagesOf(hits[0]!))).not.toContain("steer-")
      expect(body.indexOf("steer-first")).toBeGreaterThan(-1)
      expect(body.indexOf("steer-first")).toBeLessThan(body.indexOf("steer-second"))
      const one = yield* admittedRow(first)
      const two = yield* admittedRow(second)
      expect(one?.promotedSeq ?? Infinity).toBeLessThan(two?.promotedSeq ?? -Infinity)
      // Step 1; the batch resets the allowance once, so the tool-result step is step 1 again;
      // then step 2, and the loop's last look at history (which finds the turn finished) at 3.
      expect(steps).toEqual([1, 1, 2, 3])
    }),
  30_000,
)

it.instance("a steer admitted after the boundary cutoff waits for the next boundary", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const gate = yield* Deferred.make<void>()
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Late steer" })
    // The provider is mid-response: this step's cutoff was taken before the steer existed.
    yield* llm.hold("first", deferredAsPromise(gate))
    yield* llm.text("second")

    const run = yield* prompt
      .prompt({ sessionID: chat.id, agent: "build", model: ref, parts: [{ type: "text", text: "first" }] })
      .pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const late = MessageID.ascending()
    yield* prompt.prompt({
      sessionID: chat.id,
      messageID: late,
      agent: "build",
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "late-steer" }],
    })
    expect((yield* admittedRow(late))?.promotedSeq).toBeUndefined()
    expect(yield* llm.calls).toBe(1)

    yield* Deferred.succeed(gate, void 0)
    const last = yield* awaitWithTimeout(Fiber.join(run), "the drain never finished", "20 seconds")
    expect(last.info.role === "assistant" && last.info.parentID).toBe(late)
    expect(yield* llm.calls).toBe(2)
    expect(JSON.stringify(messagesOf((yield* llm.hits)[1]!))).toContain("late-steer")
    expect((yield* admittedRow(late))?.promotedSeq).toBeDefined()
  }),
)

it.instance("reverting a pending prompt drops its inbox row", () =>
  Effect.gen(function* () {
    yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const revert = yield* SessionRevert.Service
    const chat = yield* sessions.create({ title: "Revert pending" })
    yield* seed(chat.id, { finish: "stop" })

    const pending = MessageID.ascending()
    yield* prompt.prompt({
      sessionID: chat.id,
      messageID: pending,
      agent: "build",
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "take this back" }],
    })
    expect(yield* admittedRow(pending)).toBeDefined()

    yield* revert.revert({ sessionID: chat.id, messageID: pending })
    yield* revert.cleanup(yield* sessions.get(chat.id))
    expect(yield* admittedRow(pending)).toBeUndefined()
    expect((yield* sessions.messages({ sessionID: chat.id })).some((msg) => msg.info.id === pending)).toBe(false)
  }),
)

it.instance("forking a session leaves pending prompts behind", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Fork" })
    yield* llm.text("answered")
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", model: ref, parts: [{ type: "text", text: "hello" }] })

    const pending = MessageID.ascending()
    yield* prompt.prompt({
      sessionID: chat.id,
      messageID: pending,
      agent: "build",
      model: ref,
      noReply: true,
      parts: [{ type: "text", text: "not-yet-promoted" }],
    })

    const fork = yield* sessions.fork({ sessionID: chat.id })
    const copied = yield* sessions.messages({ sessionID: fork.id })
    expect(copied.map((msg) => msg.info.role)).toEqual(["user", "assistant"])
    expect(JSON.stringify(copied)).not.toContain("not-yet-promoted")
    expect((yield* sessions.messages({ sessionID: chat.id })).some((msg) => msg.info.id === pending)).toBe(true)
  }),
)

it.instance("a prompt admitted by a process that died is promoted by the next loop", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Restart" })

    // Exactly what an accepted prompt leaves in the database when the process dies before the
    // loop runs: the inbox row and the V1 rows, with nothing in memory.
    const id = MessageID.ascending()
    yield* SessionInput.admit(db, events, {
      id: SessionMessage.ID.make(id),
      sessionID: chat.id,
      prompt: Prompt.fromUserMessage({ text: "from before" }),
      delivery: "steer",
    })
    yield* sessions.updateMessage({
      id,
      role: "user",
      sessionID: chat.id,
      agent: "build",
      model: ref,
      time: { created: Date.now() },
    })
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: id,
      sessionID: chat.id,
      type: "text",
      text: "from before",
    })
    expect((yield* admittedRow(id))?.promotedSeq).toBeUndefined()

    yield* llm.text("picked up")
    const result = yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the loop never finished", "20 seconds")
    expect(result.info.role === "assistant" && result.info.parentID).toBe(id)
    expect(result.parts.some((part) => part.type === "text" && part.text === "picked up")).toBe(true)
    expect((yield* admittedRow(id))?.promotedSeq).toBeDefined()
    expect(yield* llm.calls).toBe(1)
    expect(JSON.stringify(messagesOf((yield* llm.hits)[0]!))).toContain("from before")
  }),
)

it.instance("loop continues when finish is tool-calls", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.tool("first", { value: "first" })
    yield* llm.text("second")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(yield* llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
      expect(result.info.finish).toBe("stop")
    }
  }),
)

it.instance("glob tool keeps instance context during prompt runs", () =>
  Effect.gen(function* () {
    const { dir, llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Glob context",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    const file = path.join(dir, "probe.txt")
    yield* writeText(file, "probe")

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "find text files" }],
    })
    yield* llm.tool("glob", { pattern: "**/*.txt" })
    yield* llm.text("done")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(result.info.role).toBe("assistant")

    const msgs = yield* MessageV2.filterCompactedEffect(session.id)
    const tool = msgs
      .flatMap((msg) => msg.parts)
      .find(
        (part): part is CompletedToolPart =>
          part.type === "tool" && part.tool === "glob" && part.state.status === "completed",
      )
    if (!tool) return

    expect(tool.state.output).toContain(file)
    expect(tool.state.output).not.toContain("No context found for instance")
    expect(result.parts.some((part) => part.type === "text" && part.text === "done")).toBe(true)
  }),
)

it.instance("loop continues when finish is stop but assistant has tool parts", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "hello" }],
    })
    yield* llm.push(reply().tool("first", { value: "first" }).stop())
    yield* llm.text("second")

    const result = yield* prompt.loop({ sessionID: session.id })
    expect(yield* llm.calls).toBe(2)
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)
      expect(result.info.finish).toBe("stop")
    }
  }),
)

it.instance("failed subtask preserves metadata on error tool state", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      agent: {
        general: {
          model: "test/missing-model",
        },
      },
    }))
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.tool("task", {
      description: "inspect bug",
      prompt: "look into the cache key path",
      subagent_type: "general",
    })
    yield* llm.text("done")
    const msg = yield* user(chat.id, "hello")
    yield* addSubtask(chat.id, msg.id)

    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.role).toBe("assistant")
    expect(yield* llm.calls).toBe(2)

    const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
    const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
    expect(taskMsg?.info.role).toBe("assistant")
    if (!taskMsg || taskMsg.info.role !== "assistant") return

    const tool = errorTool(taskMsg.parts)
    if (!tool) return

    expect(tool.state.error).toContain("Tool execution failed")
    expect(tool.state.metadata).toBeDefined()
    expect(tool.state.metadata?.sessionId).toBeDefined()
    expect(tool.state.metadata?.model).toEqual({
      providerID: ProviderV2.ID.make("test"),
      modelID: ModelV2.ID.make("missing-model"),
    })
  }),
)

it.instance("subtask child inherits parent session external_directory allow", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({
      title: "Parent",
      permission: [{ permission: "external_directory", pattern: "/tmp/allowed/*", action: "allow" }],
    })
    yield* llm.text("done")
    const msg = yield* user(chat.id, "hello")
    yield* addSubtask(chat.id, msg.id)

    yield* prompt.loop({ sessionID: chat.id })

    const kids = yield* sessions.children(chat.id)
    expect(kids).toHaveLength(1)
    const child = kids[0]!
    const rules = child.permission ?? []
    expect(rules).toEqual(
      expect.arrayContaining([{ permission: "external_directory", pattern: "/tmp/allowed/*", action: "allow" }]),
    )
    expect(Permission.evaluate("external_directory", "/tmp/allowed/file", rules).action).toBe("allow")
    expect(Permission.evaluate("task", "anything", rules).action).toBe("deny")
  }),
)

noLLMServer.instance("prompt tools replace previous prompt tool rules", () =>
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt tools" })

    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      tools: { bash: false },
      parts: [{ type: "text", text: "first" }],
    })
    yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      noReply: true,
      tools: { read: true },
      parts: [{ type: "text", text: "second" }],
    })

    const reloaded = yield* sessions.get(session.id)
    expect(reloaded.permission).toEqual([{ permission: "read", pattern: "*", action: "allow" }])
    expect(Permission.evaluate("bash", "anything", reloaded.permission ?? []).action).toBe("ask")
  }),
)

it.instance(
  "running subtask preserves metadata after tool-call transition",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

      const tool = yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
          const tool = taskMsg?.parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
          if (tool?.state.status === "running" && tool.state.metadata?.sessionId) return tool
        }),
        "timed out waiting for running subtask metadata",
      )

      if (tool.state.status !== "running") return
      expect(typeof tool.state.metadata?.sessionId).toBe("string")
      expect(tool.state.title).toBeDefined()
      expect(tool.state.metadata?.model).toBeDefined()

      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
    }),
  5_000,
)

it.instance(
  "running task tool preserves metadata after tool-call transition",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.tool("task", {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
      })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

      const tool = yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const assistant = msgs.findLast((item) => item.info.role === "assistant" && item.info.agent === "build")
          const tool = assistant?.parts.find(
            (part): part is SessionV1.ToolPart => part.type === "tool" && part.tool === "task",
          )
          if (tool?.state.status === "running" && tool.state.metadata?.sessionId) return tool
        }),
        "timed out waiting for running task metadata",
      )

      if (tool.state.status !== "running") return
      expect(typeof tool.state.metadata?.sessionId).toBe("string")
      expect(tool.state.title).toBe("inspect bug")
      expect(tool.state.metadata?.model).toBeDefined()

      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
    }),
  10_000,
)

it.instance(
  "loop sets status to busy then idle",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const status = yield* SessionStatus.Service

      yield* llm.hang

      const chat = yield* sessions.create({})
      yield* user(chat.id, "hi")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      expect((yield* status.get(chat.id)).type).toBe("busy")
      yield* prompt.cancel(chat.id)
      yield* Fiber.await(fiber)
      expect((yield* status.get(chat.id)).type).toBe("idle")
    }),
  3_000,
)

// Cancel semantics

it.instance("cancel interrupts loop and resolves with an assistant message", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* seed(chat.id)

    yield* llm.hang

    yield* user(chat.id, "more")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)
    yield* prompt.cancel(chat.id)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.info.role).toBe("assistant")
    }
  }),
)

it.instance(
  "ends a turn whose provider goes quiet, and says so on the message",
  () =>
    Effect.gen(function* () {
      // Short enough for a test, long enough to survive the gap between creating the step handle and
      // the provider's first byte. At 1 ms and 2 ms the watchdog was correct and the test was wrong:
      // it ended the turn during that gap — which is exactly the case it exists for — before the
      // request went out at all, so on a slow machine the provider was never called.
      const { llm } = yield* useServerConfig((url) => ({
        ...providerCfg(url),
        experimental: { turn_stall: { warn_ms: 500, abort_ms: 1500 } },
      }))
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* seed(chat.id)

      yield* llm.hang
      yield* user(chat.id, "more")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      // Each stage names itself: an unadorned wait here reports only bun's "timed out", which says
      // nothing about whether the provider was ever called or the turn ever started.
      yield* awaitWithTimeout(llm.wait(1), "the provider was never called", "20 seconds")
      yield* awaitWithTimeout(waitForBusy(chat.id), "the session never went busy", "20 seconds")

      // No cancel of our own: the watchdog is the only thing that can end this.
      const exit = yield* awaitWithTimeout(Fiber.await(fiber), "watchdog never ended the stalled turn", "20 seconds")
      expect(Exit.isSuccess(exit)).toBe(true)

      const messages = yield* sessions.messages({ sessionID: chat.id })
      const assistant = messages.findLast(
        (item): item is (typeof messages)[number] & { info: SessionV1.Assistant } => item.info.role === "assistant",
      )
      expect(assistant?.info.error?.name).toBe("MessageAbortedError")
      // The reason is what keeps this from reading as though the user pressed escape.
      expect((assistant?.info.error?.data as { message?: string } | undefined)?.message).toMatch(/^stopped: no output/)
    }),
  // The inner guard was 40 s against a 30 s test timeout, so it could never fire: a slow instance
  // setup killed the test with bun's own message instead of the one that says what went wrong.
  // Room for the setup, and the guard now reports first.
  60_000,
)

it.instance("leaves a turn alone while a tool is still running", () =>
  Effect.gen(function* () {
    // The case that protects real work: a tool runs inside the provider SDK and emits nothing
    // while it works, so a long command looks exactly like a provider that has gone away.
    // Short enough for a test, long enough that the gap before the provider's first byte is not
    // itself read as a stall.
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      experimental: { turn_stall: { warn_ms: 500, abort_ms: 1500 } },
    }))
    const registry = yield* ToolRegistry.Service
    const { read } = yield* registry.named()
    const { ready, restore } = yield* hangUntilAborted(read)
    yield* restore

    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* seed(chat.id)

    yield* llm.tool("read", { filePath: "/tmp/whatever" })
    yield* user(chat.id, "more")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* awaitWithTimeout(llm.wait(1), "provider was never called", "10 seconds")
    yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for the tool to start", "10 seconds")

    // Several times the abort threshold, with the tool still running throughout.
    yield* Effect.sleep("5 seconds")
    expect((yield* status.get(chat.id)).type).toBe("busy")
    // The discriminating assertion: had the watchdog fired it would have stamped its reason on
    // the message before interrupting.
    const during = yield* sessions.messages({ sessionID: chat.id })
    const running = during.findLast(
      (item): item is (typeof during)[number] & { info: SessionV1.Assistant } => item.info.role === "assistant",
    )
    expect(running?.info.error).toBeUndefined()

    yield* prompt.cancel(chat.id)
    yield* Fiber.await(fiber)
  }),
)

it.instance(
  "stops a tool that never returns and hands the failure to the model",
  () =>
    Effect.gen(function* () {
      // The gap the turn watchdog cannot close: a tool in flight counts as work, so a tool that
      // never returns holds the turn open forever with no output and no error.
      const { llm } = yield* useServerConfig((url) => ({
        ...providerCfg(url),
        experimental: { tool_timeout: 500 },
      }))
      const registry = yield* ToolRegistry.Service
      const { read } = yield* registry.named()
      const { ready, restore } = yield* hangUntilAborted(read)
      yield* restore

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* seed(chat.id)

      yield* llm.tool("read", { filePath: "/tmp/whatever" })
      yield* llm.text("that path does not answer")
      yield* user(chat.id, "more")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for the tool to start", "10 seconds")

      // The turn finishes on its own: no cancel, no interrupt, well inside a timeout that would
      // catch the old wedge.
      yield* awaitWithTimeout(Fiber.await(fiber), "the turn never finished", "20 seconds")

      const messages = yield* sessions.messages({ sessionID: chat.id })
      const assistant = messages.findLast(
        (item): item is (typeof messages)[number] & { info: SessionV1.Assistant } => item.info.role === "assistant",
      )
      // Not an aborted turn — an ordinary tool failure the model was free to answer.
      expect(assistant?.info.error).toBeUndefined()
      const failed = messages
        .flatMap((item) => item.parts)
        .find((part) => part.type === "tool" && part.state.status === "error")
      expect(failed).toBeDefined()
      expect((failed as { state: { error: string } }).state.error).toMatch(/read tool was still running/)
    }),
  30_000,
)

it.instance(
  "corrects a model that repeats itself, then ends the turn if nothing changes",
  () =>
    Effect.gen(function* () {
      // The old detector needed three byte-identical parts in a row, so one reasoning part hid the
      // loop, and when it did fire it asked the user a question that could wait forever.
      const { llm, dir } = yield* useServerConfig((url) => ({
        ...providerCfg(url),
        experimental: { loop_guard: { correct_at: 2, stop_at: 3 } },
      }))
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* seed(chat.id)

      // Inside the instance directory: an external path would stop on a permission prompt instead.
      const same = { filePath: path.join(dir, "not-here.txt") }
      yield* llm.tool("read", same)
      yield* llm.tool("read", same)
      yield* llm.tool("read", same)
      yield* llm.text("giving up")
      yield* user(chat.id, "read that file")

      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the turn never finished", "30 seconds")

      const parts = (yield* sessions.messages({ sessionID: chat.id })).flatMap((item) => item.parts)
      const errors = parts.flatMap((part) =>
        part.type === "tool" && part.state.status === "error" ? [part.state.error] : [],
      )
      // The second identical call is answered by the guard, not by running the tool again, and the
      // model is told exactly what it repeated.
      expect(errors.some((text) => text.includes("identical arguments"))).toBe(true)
      // The third ends the turn rather than asking anyone whether to keep going.
      expect(errors.some((text) => text.startsWith("Stopped:"))).toBe(true)
    }),
  60_000,
)

it.instance(
  "does not let naming the session hold up the turn",
  () =>
    Effect.gen(function* () {
      // Naming happens inside the turn loop against a small model, and it is not covered by the
      // turn's watchdog, so a provider that stops answering there used to hold up the work the user
      // actually asked for with nothing on screen.
      const { llm } = yield* useServerConfig((url) => ({
        ...providerCfg(url),
        experimental: { aux_timeout: 500 },
      }))
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      // The name is only generated for a session still carrying its default one.
      const title = `New session - ${new Date().toISOString()}`
      const chat = yield* sessions.create({ title })

      yield* llm.hangTitles
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "say something" }],
      })
      yield* llm.text("done")

      const result = yield* awaitWithTimeout(
        prompt.loop({ sessionID: chat.id }),
        "the turn never finished",
        "20 seconds",
      )

      // The turn produced its answer; only the name was given up on.
      expect(result.parts).toContainEqual(expect.objectContaining({ type: "text", text: "done" }))
      expect((yield* sessions.get(chat.id)).title).toBe(title)
    }),
  60_000,
)

it.instance(
  "writes down that a guard intervened, so the thresholds can be argued from evidence",
  () =>
    Effect.gen(function* () {
      // Every threshold in the guards was chosen by argument. This is the record that lets the next
      // one be chosen by measurement: which guard fired, on what, how often.
      const { llm } = yield* useServerConfig((url) => ({
        ...providerCfg(url),
        experimental: { tool_timeout: 500 },
      }))
      const registry = yield* ToolRegistry.Service
      const { read } = yield* registry.named()
      const { ready, restore } = yield* hangUntilAborted(read)
      yield* restore

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const guards = yield* SessionGuardLog.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* seed(chat.id)

      yield* llm.tool("read", { filePath: "/tmp/whatever" })
      yield* llm.text("that path does not answer")
      yield* user(chat.id, "more")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for the tool to start", "10 seconds")
      yield* awaitWithTimeout(Fiber.await(fiber), "the turn never finished", "20 seconds")

      const trips = yield* guards.recent()
      const timeout = trips.find((trip) => trip.guard === "tool_timeout")
      expect(timeout).toBeDefined()
      expect(timeout?.action).toBe("stop")
      expect(timeout?.subject).toBe("read")
      expect(timeout?.sessionID).toBe(chat.id)
      // And it aggregates, which is what makes a week of use readable.
      expect(yield* guards.summary()).toContainEqual({ guard: "tool_timeout", action: "stop", count: 1 })
    }),
  60_000,
)

it.instance(
  "closes a turn left open by a process that died, instead of carrying it forever",
  () =>
    Effect.gen(function* () {
      // `time.completed` is written by the process running the turn. Killed mid-turn — an OOM, a
      // machine asleep — nobody writes it, and the message stays open for the rest of the session's
      // life: the TUI reads open as "in progress" and stamps QUEUED on everything typed after it,
      // across restarts, with nothing running.
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const guards = yield* SessionGuardLog.Service
      const chat = yield* sessions.create({ title: "Pinned" })

      const seeded = yield* seed(chat.id)
      // Exactly what a killed process leaves behind: an assistant message with no completion.
      const abandoned = { ...seeded.assistant, time: { created: seeded.assistant.time.created } }
      yield* sessions.updateMessage(abandoned)
      expect((yield* sessions.messages({ sessionID: chat.id })).some((m) => m.info.id === abandoned.id)).toBe(true)

      yield* llm.text("carrying on")
      yield* user(chat.id, "still there?")
      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the turn never finished", "30 seconds")

      const messages = yield* sessions.messages({ sessionID: chat.id })
      const reaped = messages.find((item) => item.info.id === abandoned.id)
      expect(reaped?.info.role === "assistant" && reaped.info.time.completed).toBeTruthy()
      expect((reaped?.info as SessionV1.Assistant).error?.name).toBe("MessageAbortedError")
      // And it is counted, so a week of these says the OOM came back.
      expect((yield* guards.summary()).some((row) => row.guard === "orphan")).toBe(true)
    }),
  60_000,
)

it.instance("cancel records MessageAbortedError on interrupted process", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.hang
    yield* user(chat.id, "hello")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)
    yield* prompt.cancel(chat.id)
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      const info = exit.value.info
      if (info.role === "assistant") {
        expect(info.error?.name).toBe("MessageAbortedError")
      }
    }
  }),
)

raceNoLLMServer.instance(
  "finalizes assistant when cancelled before processor creation completes",
  () =>
    Effect.gen(function* () {
      processorCreateStarted.length = 0
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          processorCreateStarted.length = 0
        }),
      )

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Processor creation race" })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "first" }],
      })

      const firstCreate = defer<void>()
      processorCreateStarted.push(firstCreate.resolve)
      const first = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.promise(() => firstCreate.promise)

      yield* prompt.cancel(chat.id)
      const firstExit = yield* Fiber.await(first)
      expect(Exit.isSuccess(firstExit)).toBe(true)

      let messages = yield* sessions.messages({ sessionID: chat.id })
      const firstInterrupted = messages.at(-1)
      expect(firstInterrupted?.info.role).toBe("assistant")
      expect(firstInterrupted?.parts).toHaveLength(0)
      if (firstInterrupted?.info.role === "assistant") {
        expect(firstInterrupted.info.finish).toBeUndefined()
        expect(firstInterrupted.info.time.completed).toBeNumber()
        expect(firstInterrupted.info.error?.name).toBe("MessageAbortedError")
      }

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "second" }],
      })

      const secondCreate = defer<void>()
      processorCreateStarted.push(secondCreate.resolve)
      const second = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.promise(() => secondCreate.promise)

      yield* prompt.cancel(chat.id)
      const secondExit = yield* Fiber.await(second)
      expect(Exit.isSuccess(secondExit)).toBe(true)

      messages = yield* sessions.messages({ sessionID: chat.id })
      const poisonMessages = messages.filter(
        (message) =>
          message.info.role === "assistant" &&
          message.parts.length === 0 &&
          !message.info.finish &&
          !message.info.time.completed &&
          !message.info.error,
      )
      expect(poisonMessages).toHaveLength(0)

      const interruptedMessages = messages.filter(
        (message) =>
          message.info.role === "assistant" &&
          message.parts.length === 0 &&
          message.info.time.completed &&
          message.info.error?.name === "MessageAbortedError",
      )
      expect(interruptedMessages).toHaveLength(2)

      const lastUser = messages.at(-2)
      const lastAssistant = messages.at(-1)
      expect(lastUser?.info.role).toBe("user")
      expect(lastAssistant?.info.role).toBe("assistant")
      if (lastUser?.info.role === "user" && lastAssistant?.info.role === "assistant") {
        expect(lastAssistant.info.parentID).toBe(lastUser?.info.id)
      }
    }),
  { config: cfg },
  3_000,
)

noLLMServer.instance(
  "cancel finalizes subtask tool state",
  () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      const aborted = yield* Deferred.make<void>()
      const registry = yield* ToolRegistry.Service
      const { task } = yield* registry.named()
      const original = task.execute
      task.execute = (_args, ctx) =>
        Effect.callback<never>((_resume) => {
          ctx.abort.addEventListener("abort", () => succeedVoid(aborted), { once: true })
          if (ctx.abort.aborted) succeedVoid(aborted)
          succeedVoid(ready)
          return Effect.sync(() => succeedVoid(aborted))
        })
      yield* Effect.addFinalizer(() => Effect.sync(() => void (task.execute = original)))

      const { prompt, chat } = yield* boot()
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for task tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
      yield* awaitWithTimeout(Deferred.await(aborted), "timed out waiting for task tool abort", "10 seconds")

      const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
      const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
      expect(taskMsg?.info.role).toBe("assistant")
      if (!taskMsg || taskMsg.info.role !== "assistant") return

      const tool = toolPart(taskMsg.parts)
      expect(tool?.type).toBe("tool")
      if (!tool) return

      expect(tool.state.status).not.toBe("running")
      expect(taskMsg.info.time.completed).toBeDefined()
      expect(taskMsg.info.finish).toBeDefined()
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "cancel propagates from slash command subtask to child session",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const status = yield* SessionStatus.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      const msg = yield* user(chat.id, "hello")
      yield* addSubtask(chat.id, msg.id)

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)

      const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
      const taskMsg = msgs.find((item) => item.info.role === "assistant" && item.info.agent === "general")
      const tool = taskMsg ? toolPart(taskMsg.parts) : undefined
      const sessionID = tool?.state.status === "running" ? tool.state.metadata?.sessionId : undefined
      expect(typeof sessionID).toBe("string")
      if (typeof sessionID !== "string") throw new Error("missing child session id")
      const childID = SessionID.make(sessionID)
      expect((yield* status.get(childID)).type).toBe("busy")

      yield* prompt.cancel(chat.id)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)

      expect((yield* status.get(chat.id)).type).toBe("idle")
      expect((yield* status.get(childID)).type).toBe("idle")
    }),
  10_000,
)

it.instance(
  "cancel with queued callers resolves all cleanly",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Pinned" })
      yield* llm.hang
      yield* user(chat.id, "hello")

      const a = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      const b = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      yield* prompt.cancel(chat.id)
      const [exitA, exitB] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
      expect(Exit.isSuccess(exitA)).toBe(true)
      expect(Exit.isSuccess(exitB)).toBe(true)
      if (Exit.isSuccess(exitA) && Exit.isSuccess(exitB)) {
        expect(exitA.value.info.id).toBe(exitB.value.info.id)
      }
    }),
  { git: true },
  10_000,
)

// Queue semantics

noLLMServer.instance("concurrent loop callers get same result", () =>
  Effect.gen(function* () {
    const { prompt, run, chat } = yield* boot()
    yield* seed(chat.id, { finish: "stop" })

    const [a, b] = yield* Effect.all([prompt.loop({ sessionID: chat.id }), prompt.loop({ sessionID: chat.id })], {
      concurrency: "unbounded",
    })

    expect(a.info.id).toBe(b.info.id)
    expect(a.info.role).toBe("assistant")
    yield* run.assertNotBusy(chat.id)
  }),
)

it.instance("concurrent loop callers all receive same error result", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.fail("boom")
    yield* user(chat.id, "hello")

    const [a, b] = yield* Effect.all([prompt.loop({ sessionID: chat.id }), prompt.loop({ sessionID: chat.id })], {
      concurrency: "unbounded",
    })
    expect(a.info.id).toBe(b.info.id)
    expect(a.info.role).toBe("assistant")
  }),
)

it.instance("prompt submitted during an active run is included in the next LLM input", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const gate = yield* Deferred.make<void>()
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })

    yield* llm.hold("first", deferredAsPromise(gate))
    yield* llm.text("second")

    const a = yield* prompt
      .prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "first" }],
      })
      .pipe(Effect.forkChild)

    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const id = MessageID.ascending()
    const b = yield* prompt
      .prompt({
        sessionID: chat.id,
        messageID: id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "second" }],
      })
      .pipe(Effect.forkChild)

    yield* pollWithTimeout(
      sessions
        .messages({ sessionID: chat.id })
        .pipe(
          Effect.map((msgs) => (msgs.some((msg) => msg.info.role === "user" && msg.info.id === id) ? true : undefined)),
        ),
      "timed out waiting for second prompt to save",
    )

    yield* Deferred.succeed(gate, void 0)

    const [ea, eb] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
    expect(Exit.isSuccess(ea)).toBe(true)
    expect(Exit.isSuccess(eb)).toBe(true)
    expect(yield* llm.calls).toBe(2)

    const msgs = yield* sessions.messages({ sessionID: chat.id })
    const assistants = msgs.filter((msg) => msg.info.role === "assistant")
    expect(assistants).toHaveLength(2)
    const last = assistants.at(-1)
    if (!last || last.info.role !== "assistant") throw new Error("expected second assistant")
    expect(last.info.parentID).toBe(id)
    expect(last.parts.some((part) => part.type === "text" && part.text === "second")).toBe(true)

    const inputs = yield* llm.inputs
    expect(inputs).toHaveLength(2)
    const messages = inputs.at(-1)?.messages
    if (!Array.isArray(messages)) throw new Error("expected LLM messages")
    // The prompt text leads; the task-state reminder rides behind it instead of in the system prompt.
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "second" },
        { type: "text", text: SessionTodo.context([]) },
      ],
    })
  }),
)

it.instance("assertNotBusy fails with BusyError when loop running", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const run = yield* SessionRunState.Service
    const sessions = yield* Session.Service
    yield* llm.hang

    const chat = yield* sessions.create({})
    yield* user(chat.id, "hi")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const exit = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
      expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "SessionBusyError", sessionID: chat.id })
    }

    yield* prompt.cancel(chat.id)
    yield* Fiber.await(fiber)
  }),
)

noLLMServer.instance("assertNotBusy succeeds when idle", () =>
  Effect.gen(function* () {
    const run = yield* SessionRunState.Service
    const sessions = yield* Session.Service

    const chat = yield* sessions.create({})
    const exit = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
    expect(Exit.isSuccess(exit)).toBe(true)
  }),
)

// Shell semantics

it.instance("shell rejects with BusyError when loop running", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Pinned" })
    yield* llm.hang
    yield* user(chat.id, "hi")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)

    const exit = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "echo hi" }).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
      expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "SessionBusyError", sessionID: chat.id })
    }

    yield* prompt.cancel(chat.id)
    yield* Fiber.await(fiber)
  }),
)

unixNoLLMServer(
  "shell captures stdout and stderr in completed tool output",
  () =>
    Effect.gen(function* () {
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "printf out && printf err >&2",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.output).toContain("out")
      expect(tool.state.output).toContain("err")
      expect(tool.state.metadata.output).toContain("out")
      expect(tool.state.metadata.output).toContain("err")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell completes a fast command on the preferred shell",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "pwd",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.input.command).toBe("pwd")
      expect(tool.state.output).toContain(dir)
      expect(tool.state.metadata.output).toContain(dir)
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell uses configured shell over env shell",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        if (!(yield* hasBash)) return

        const { prompt, chat } = yield* boot()
        const result = yield* prompt.shell({
          sessionID: chat.id,
          agent: "build",
          command: "[[ 1 -eq 1 ]] && printf configured",
        })

        const tool = completedTool(result.parts)
        if (!tool) return
        expect(tool.state.output).toContain("configured")
      }),
    ),
  { config: { ...cfg, shell: "bash" } },
  30_000,
)

unixNoLLMServer(
  "shell commands can change directory after startup",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { directory: dir } = yield* TestInstance
        const { prompt, run, chat } = yield* boot()
        const parent = path.dirname(dir)
        const result = yield* prompt.shell({
          sessionID: chat.id,
          agent: "build",
          command: "cd .. && pwd",
        })

        expect(result.info.role).toBe("assistant")
        const tool = completedTool(result.parts)
        if (!tool) return

        expect(tool.state.output).toContain(parent)
        expect(tool.state.metadata.output).toContain(parent)
        yield* run.assertNotBusy(chat.id)
      }),
    ),
  { config: cfg },
)

unixNoLLMServer(
  "shell lists files from the project directory",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const { prompt, run, chat } = yield* boot()
      yield* writeText(path.join(dir, "README.md"), "# e2e\n")

      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "command ls",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.input.command).toBe("command ls")
      expect(tool.state.output).toContain("README.md")
      expect(tool.state.metadata.output).toContain("README.md")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell captures stderr from a failing command",
  () =>
    Effect.gen(function* () {
      const { prompt, run, chat } = yield* boot()
      const result = yield* prompt.shell({
        sessionID: chat.id,
        agent: "build",
        command: "command -v __nonexistent_cmd_e2e__ || echo 'not found' >&2; exit 1",
      })

      expect(result.info.role).toBe("assistant")
      const tool = completedTool(result.parts)
      if (!tool) return

      expect(tool.state.output).toContain("not found")
      expect(tool.state.metadata.output).toContain("not found")
      yield* run.assertNotBusy(chat.id)
    }),
  { config: cfg },
)

unixNoLLMServer(
  "shell updates running metadata before process exit",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()

        const fiber = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: "printf first && sleep 0.2 && printf second" })
          .pipe(Effect.forkChild)

        yield* pollWithTimeout(
          Effect.gen(function* () {
            const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
            const taskMsg = msgs.find((item) => item.info.role === "assistant")
            const tool = taskMsg ? toolPart(taskMsg.parts) : undefined
            if (tool?.state.status === "running" && tool.state.metadata?.output.includes("first")) return true
          }),
          "timed out waiting for running shell metadata",
        )

        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
      }),
    ),
  { config: cfg },
  30_000,
)

unixNoLLMServer(
  "shell coalesces bursty durable progress updates",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()
        const events = yield* EventV2Bridge.Service
        const updates: string[] = []
        const off = yield* events.listen((event) => {
          if (event.type !== MessageV2.Event.PartUpdated.type) return Effect.void
          const part = (event.data as typeof MessageV2.Event.PartUpdated.data.Type).part
          if (
            part.sessionID === chat.id &&
            part.type === "tool" &&
            part.state.status === "running" &&
            part.state.metadata?.output
          )
            updates.push(part.state.metadata.output)
          return Effect.void
        })

        const command = "i=0; while [ $i -lt 64 ]; do printf '%s\\n' $i; i=$((i + 1)); sleep 0.01; done"
        const result = yield* prompt.shell({ sessionID: chat.id, agent: "build", command })
        yield* off

        expect(updates.length).toBeGreaterThan(1)
        expect(updates.length).toBeLessThan(16)
        expect(updates.at(-1)).toContain("63")
        const tool = completedTool(result.parts)
        expect(tool?.state.output).toContain("63")
      }),
    ),
  { config: cfg },
  30_000,
)

it.instance(
  "loop waits while shell runs and starts after shell exits",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.text("after-shell")

      const sh = yield* prompt
        .shell({ sessionID: chat.id, agent: "build", command: "sleep 0.2" })
        .pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const loop = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      expect(yield* llm.calls).toBe(0)

      yield* Fiber.await(sh)
      const exit = yield* Fiber.await(loop)

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.info.role).toBe("assistant")
        expect(exit.value.parts.some((part) => part.type === "text" && part.text === "after-shell")).toBe(true)
      }
      expect(yield* llm.calls).toBe(1)
    }),
  { git: true },
  10_000,
)

it.instance(
  "shell completion resumes queued loop callers",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Pinned",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      yield* llm.text("done")

      const sh = yield* prompt
        .shell({ sessionID: chat.id, agent: "build", command: "sleep 0.2" })
        .pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const a = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      const b = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      expect(yield* llm.calls).toBe(0)

      yield* Fiber.await(sh)
      const [ea, eb] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])

      expect(Exit.isSuccess(ea)).toBe(true)
      expect(Exit.isSuccess(eb)).toBe(true)
      if (Exit.isSuccess(ea) && Exit.isSuccess(eb)) {
        expect(ea.value.info.id).toBe(eb.value.info.id)
        expect(ea.value.info.role).toBe("assistant")
      }
      expect(yield* llm.calls).toBe(1)
    }),
  { git: true },
  10_000,
)

unix(
  "command ! expansion uses configured shell over env shell",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        if (!(yield* hasBash)) return
        const { llm } = yield* useServerConfig((url) => ({
          ...providerCfg(url),
          shell: "bash",
          command: {
            probe: {
              template: "Probe: !`[[ 1 -eq 1 ]] && printf configured`",
            },
          },
        }))

        const { prompt, chat } = yield* boot()
        yield* llm.text("done")

        const result = yield* prompt.command({
          sessionID: chat.id,
          command: "probe",
          arguments: "",
        })

        expect(result.info.role).toBe("assistant")
        const inputs = yield* llm.inputs
        expect(JSON.stringify(inputs.at(-1)?.messages)).toContain("configured")
      }),
    ),
  30_000,
)

unixNoLLMServer(
  "cancel interrupts shell and resolves cleanly",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, run, chat } = yield* boot()
        const { directory: dir } = yield* TestInstance
        const afs = yield* FSUtil.Service
        const ready = path.join(dir, ".shell-ready")

        const sh = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: ": > '.shell-ready'; sleep 30" })
          .pipe(Effect.forkChild)
        yield* pollWithTimeout(
          afs.existsSafe(ready).pipe(Effect.map((exists) => (exists ? (true as const) : undefined))),
          "shell never created readiness marker",
        )

        yield* prompt.cancel(chat.id)

        const status = yield* SessionStatus.Service
        expect((yield* status.get(chat.id)).type).toBe("idle")
        const busy = yield* run.assertNotBusy(chat.id).pipe(Effect.exit)
        expect(Exit.isSuccess(busy)).toBe(true)

        const exit = yield* Fiber.await(sh)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          expect(exit.value.info.role).toBe("assistant")
          const tool = completedTool(exit.value.parts)
          if (tool) {
            expect(tool.state.output).toContain("User aborted the command")
          }
        }
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

unixNoLLMServer(
  "cancel persists aborted shell result when shell ignores TERM",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()
        const { directory: dir } = yield* TestInstance
        const afs = yield* FSUtil.Service
        const ready = path.join(dir, ".trap-ready")

        const sh = yield* prompt
          .shell({
            sessionID: chat.id,
            agent: "build",
            // Touch marker AFTER trap installs so the test waits for the actual
            // ignore-TERM state before cancelling; otherwise SIGTERM can arrive
            // before `trap` runs and the escalation path is never exercised.
            command: `trap '' TERM; touch "${ready}"; sleep 30`,
          })
          .pipe(Effect.forkChild)

        yield* Effect.gen(function* () {
          while (!(yield* afs.existsSafe(ready))) {
            yield* Effect.sleep(Duration.millis(10))
          }
        }).pipe(Effect.timeout(Duration.seconds(5)))

        yield* prompt.cancel(chat.id)

        const exit = yield* Fiber.await(sh)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          expect(exit.value.info.role).toBe("assistant")
          const tool = completedTool(exit.value.parts)
          if (tool) {
            expect(tool.state.output).toContain("User aborted the command")
          }
        }
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

unix(
  "cancel finalizes interrupted bash tool output through normal truncation",
  () =>
    Effect.gen(function* () {
      const { dir, llm } = yield* useServerConfig(providerCfg)
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({
        title: "Interrupted bash truncation",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "run bash" }],
      })

      yield* llm.tool("bash", {
        command:
          'i=0; while [ "$i" -lt 4000 ]; do printf "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx %05d\\n" "$i"; i=$((i + 1)); done; printf truncation-ready; sleep 30',
        timeout: 30_000,
        workdir: path.resolve(dir),
      })

      const run = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* llm.wait(1)
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const assistant = msgs.findLast((item) => item.info.role === "assistant")
          const tool = assistant ? toolPart(assistant.parts) : undefined
          if (tool?.state.status === "running" && tool.state.metadata?.output.includes("truncation-ready")) return true
        }),
        "timed out waiting for truncated shell output",
      )
      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(run)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isFailure(exit)) return

      const tool = completedTool(exit.value.parts)
      if (!tool) return

      expect(tool.state.metadata.truncated).toBe(true)
      expect(typeof tool.state.metadata.outputPath).toBe("string")
      expect(tool.state.output).toMatch(/\.\.\.output truncated\.\.\./)
      expect(tool.state.output).toMatch(/Full output saved to:\s+\S+/)
      expect(tool.state.output).not.toContain("Tool execution aborted")
    }),
  30_000,
)

unixNoLLMServer(
  "cancel interrupts loop queued behind shell",
  () =>
    Effect.gen(function* () {
      const { prompt, chat } = yield* boot()

      const sh = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "sleep 30" }).pipe(Effect.forkChild)
      yield* waitForBusy(chat.id)

      const loop = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* Effect.sleep(50)

      yield* prompt.cancel(chat.id)

      const exit = yield* Fiber.await(loop)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        const tool = completedTool(exit.value.parts)
        expect(tool?.state.output).toContain("User aborted the command")
      }

      yield* Fiber.await(sh)
    }),
  { git: true, config: cfg },
  30_000,
)

unixNoLLMServer(
  "shell rejects when another shell is already running",
  () =>
    withSh(() =>
      Effect.gen(function* () {
        const { prompt, chat } = yield* boot()

        const a = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: "sleep 30" })
          .pipe(Effect.forkChild)
        yield* waitForBusy(chat.id)

        const exit = yield* prompt.shell({ sessionID: chat.id, agent: "build", command: "echo hi" }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toBeInstanceOf(Session.BusyError)
        }

        yield* prompt.cancel(chat.id)
        yield* Fiber.await(a)
      }),
    ),
  { git: true, config: cfg },
  30_000,
)

// Abort signal propagation tests for inline tool execution

function hangUntilAborted(tool: { execute: (...args: any[]) => any }) {
  return Effect.gen(function* () {
    const ready = yield* Deferred.make<void>()
    const aborted = yield* Deferred.make<void>()
    const original = tool.execute
    tool.execute = (_args: any, ctx: any) => {
      ctx.abort.addEventListener("abort", () => succeedVoid(aborted), { once: true })
      if (ctx.abort.aborted) succeedVoid(aborted)
      succeedVoid(ready)
      return Effect.callback<never>(() => Effect.sync(() => succeedVoid(aborted)))
    }
    const restore = Effect.addFinalizer(() => Effect.sync(() => void (tool.execute = original)))
    return { ready, aborted, restore }
  })
}

noLLMServer.instance(
  "interrupt propagates abort signal to read tool via file part (text/plain)",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const registry = yield* ToolRegistry.Service
      const { read } = yield* registry.named()
      const { ready, restore } = yield* hangUntilAborted(read)
      yield* restore

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Abort Test" })

      const testFile = path.join(dir, "test.txt")
      yield* writeText(testFile, "hello world")

      const fiber = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [
            { type: "text", text: "read this" },
            { type: "file", url: `file://${testFile}`, filename: "test.txt", mime: "text/plain" },
          ],
        })
        .pipe(Effect.forkChild)

      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for read tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  { config: cfg },
  30_000,
)

noLLMServer.instance(
  "interrupt propagates abort signal to read tool via file part (directory)",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const registry = yield* ToolRegistry.Service
      const { read } = yield* registry.named()
      const { ready, restore } = yield* hangUntilAborted(read)
      yield* restore

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ title: "Abort Test" })

      const fiber = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [
            { type: "text", text: "read this" },
            { type: "file", url: `file://${dir}`, filename: "dir", mime: "application/x-directory" },
          ],
        })
        .pipe(Effect.forkChild)

      yield* awaitWithTimeout(Deferred.await(ready), "timed out waiting for read tool to start", "10 seconds")
      yield* prompt.cancel(chat.id)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  { config: cfg },
  30_000,
)

// Missing file handling

noLLMServer.instance(
  "does not fail the prompt when a file part is missing",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const missing = path.join(dir, "does-not-exist.ts")
      const msg = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [
          { type: "text", text: "please review @does-not-exist.ts" },
          {
            type: "file",
            mime: "text/plain",
            url: `file://${missing}`,
            filename: "does-not-exist.ts",
          },
        ],
      })

      if (msg.info.role !== "user") throw new Error("expected user message")
      const hasFailure = msg.parts.some(
        (part) => part.type === "text" && part.synthetic && part.text.includes("Read tool failed to read"),
      )
      expect(hasFailure).toBe(true)

      yield* sessions.remove(session.id)
    }),
  { config: cfg },
)

noLLMServer.instance(
  "keeps stored part order stable when file resolution is async",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const missing = path.join(dir, "still-missing.ts")
      const msg = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [
          {
            type: "file",
            mime: "text/plain",
            url: `file://${missing}`,
            filename: "still-missing.ts",
          },
          { type: "text", text: "after-file" },
        ],
      })

      if (msg.info.role !== "user") throw new Error("expected user message")

      const stored = yield* MessageV2.get({
        sessionID: session.id,
        messageID: msg.info.id,
      })
      const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

      expect(text[0]?.startsWith("Called the Read tool with the following input:")).toBe(true)
      expect(text[1]?.includes("Read tool failed to read")).toBe(true)
      expect(text[2]).toBe("after-file")

      yield* sessions.remove(session.id)
    }),
  { config: cfg },
)

// Special characters in filenames

noLLMServer.instance(
  "handles filenames with # character",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      yield* writeText(path.join(dir, "file#name.txt"), "special content\n")

      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const parts = yield* prompt.resolvePromptParts("Read @file#name.txt")
      const fileParts = parts.filter((part) => part.type === "file")

      expect(fileParts.length).toBe(1)
      expect(fileParts[0].filename).toBe("file#name.txt")
      expect(fileParts[0].url).toContain("%23")

      const decodedPath = fileURLToPath(fileParts[0].url)
      expect(decodedPath).toBe(path.join(dir, "file#name.txt"))

      const message = yield* prompt.prompt({
        sessionID: session.id,
        parts,
        noReply: true,
      })
      const stored = yield* MessageV2.get({ sessionID: session.id, messageID: message.info.id })
      const textParts = stored.parts.filter((part) => part.type === "text")
      const hasContent = textParts.some((part) => part.text.includes("special content"))
      expect(hasContent).toBe(true)

      yield* sessions.remove(session.id)
    }),
  { git: true, config: cfg },
)

// Regression: empty assistant turn loop

it.instance("does not loop empty assistant turns for a simple reply", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt regression" })

    yield* llm.text("packages/redcode/src/session/processor.ts")

    const result = yield* prompt.prompt({
      sessionID: session.id,
      agent: "build",
      parts: [{ type: "text", text: "Where is SessionProcessor?" }],
    })

    expect(result.info.role).toBe("assistant")
    expect(result.parts.some((part) => part.type === "text" && part.text.includes("processor.ts"))).toBe(true)

    const msgs = yield* sessions.messages({ sessionID: session.id })
    expect(msgs.filter((msg) => msg.info.role === "assistant")).toHaveLength(1)
    expect(yield* llm.calls).toBe(1)
  }),
)

it.instance("records aborted errors when prompt is cancelled mid-stream", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Prompt cancel regression" })

    yield* llm.hang

    const fiber = yield* prompt
      .prompt({
        sessionID: session.id,
        agent: "build",
        parts: [{ type: "text", text: "Cancel me" }],
      })
      .pipe(Effect.forkChild)

    yield* llm.wait(1)
    yield* waitForBusy(session.id)
    yield* prompt.cancel(session.id)

    const exit = yield* Fiber.await(fiber)
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.info.role).toBe("assistant")
      if (exit.value.info.role === "assistant") {
        expect(exit.value.info.error?.name).toBe("MessageAbortedError")
      }
    }

    const msgs = yield* sessions.messages({ sessionID: session.id })
    const last = msgs.findLast((msg) => msg.info.role === "assistant")
    expect(last?.info.role).toBe("assistant")
    if (last?.info.role === "assistant") {
      expect(last.info.error?.name).toBe("MessageAbortedError")
    }
  }),
)

// Agent variant

noLLMServer.instance(
  "applies agent variant only when using agent model",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})

      const other = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        model: { providerID: ProviderV2.ID.make("opencode"), modelID: ModelV2.ID.make("kimi-k2.5-free") },
        noReply: true,
        parts: [{ type: "text", text: "hello" }],
      })
      if (other.info.role !== "user") throw new Error("expected user message")
      expect(other.info.model.variant).toBeUndefined()

      const match = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "hello again" }],
      })
      if (match.info.role !== "user") throw new Error("expected user message")
      expect(match.info.model).toEqual({
        providerID: ProviderV2.ID.make("test"),
        modelID: ModelV2.ID.make("test-model"),
        variant: "xhigh",
      })
      expect(match.info.model.variant).toBe("xhigh")

      const override = yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        variant: "high",
        parts: [{ type: "text", text: "hello third" }],
      })
      if (override.info.role !== "user") throw new Error("expected user message")
      expect(override.info.model.variant).toBe("high")

      yield* sessions.remove(session.id)
    }),
  {
    config: {
      ...cfg,
      provider: {
        ...cfg.provider,
        test: {
          ...cfg.provider.test,
          models: {
            "test-model": {
              ...cfg.provider.test.models["test-model"],
              variants: { xhigh: {}, high: {} },
            },
          },
        },
      },
      agent: {
        build: {
          model: "test/test-model",
          variant: "xhigh",
        },
      },
    },
  },
)

// Agent / command resolution errors

noLLMServer.instance(
  "unknown agent throws typed error",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .prompt({
          sessionID: session.id,
          agent: "nonexistent-agent-xyz",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err).not.toBeInstanceOf(TypeError)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain('Agent not found: "nonexistent-agent-xyz"')
        }
      }
    }),
  30_000,
)

noLLMServer.instance(
  "unknown agent error includes available agent names",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .prompt({
          sessionID: session.id,
          agent: "nonexistent-agent-xyz",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain("build")
        }
      }
    }),
  30_000,
)

noLLMServer.instance(
  "unknown command throws typed error with available names",
  () =>
    Effect.gen(function* () {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const exit = yield* prompt
        .command({
          sessionID: session.id,
          command: "nonexistent-command-xyz",
          arguments: "",
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err).not.toBeInstanceOf(TypeError)
        expect(NamedError.Unknown.isInstance(err)).toBe(true)
        if (NamedError.Unknown.isInstance(err)) {
          expect(err.data.message).toContain('Command not found: "nonexistent-command-xyz"')
          expect(err.data.message).toContain("init")
        }
      }
    }),
  30_000,
)

// ---------------------------------------------------------------------------------------------
// The goal loop
// ---------------------------------------------------------------------------------------------

/** The judge's request is the one that carries its own instruction line. */
// Matched on a fragment without quotes: inside the serialised body the quotes are escaped.
const judgeRequest = (hit: { body: Record<string, unknown> }) =>
  JSON.stringify(hit.body).includes("done|continue|blocked|wait")
const verdict = (v: string, reason: string) => JSON.stringify({ verdict: v, reason })

const startGoal = Effect.fn("test.startGoal")(function* (
  text: string,
  opts?: { maxTurns?: number; boot?: string; agent?: "plan" | "build" },
) {
  const sessions = yield* Session.Service
  const goals = yield* GoalRuntime.Service
  const prompt = yield* SessionPrompt.Service
  const chat = yield* sessions.create({ title: "Goal" })
  const goal = SessionGoal.parse(text, { maxTurns: opts?.maxTurns, stopAfter: opts?.agent })
  yield* goals.set(chat.id, opts?.boot ? { ...goal, boot: opts.boot } : goal)
  if (opts?.boot) {
    // `set` stamps this process; a foreign boot has to be written around it.
    yield* sessions.setMetadata({ sessionID: chat.id, metadata: { goal: { ...goal, boot: opts.boot } } })
  }
  yield* prompt.prompt({
    sessionID: chat.id,
    agent: opts?.agent ?? "build",
    noReply: true,
    parts: [{ type: "text", text: goal.objective }],
  })
  return { chat, goals, prompt, sessions }
})

const userTexts = Effect.fn("test.userTexts")(function* (sessionID: SessionID) {
  const sessions = yield* Session.Service
  return (yield* sessions.messages({ sessionID }))
    .filter((m) => m.info.role === "user")
    .map((m) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(""))
})

it.instance("blocked todos stop the Goal before the judge can declare completion", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const { chat, goals, prompt } = yield* startGoal("Deploy", { maxTurns: 3 })
    const todos = yield* Todo.Service
    yield* todos.update({
      sessionID: chat.id,
      todos: [{ content: "Deploy", status: "blocked", priority: "high", reason: "Need credentials" }],
    })
    yield* llm.text("Need credentials")
    yield* prompt.loop({ sessionID: chat.id })
    expect(yield* llm.calls).toBe(1)
    expect(yield* goals.get(chat.id)).toMatchObject({ status: "blocked", reason: "Deploy: Need credentials" })
  }),
)

it.instance("a CONTINUE verdict is one more synthetic turn inside the same run; DONE ends it with the goal met", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => providerCfg(url))
    const { chat, goals, prompt } = yield* startGoal("make the tests pass; verify: bun test; gate: true", {
      maxTurns: 5,
    })

    yield* llm.textMatch(judgeRequest, verdict("continue", "the tests were not run"))
    yield* llm.textMatch(judgeRequest, verdict("done", "bun test shows 12 pass"))
    yield* llm.text("I changed the code.")
    yield* llm.text("Ran bun test: 12 pass.")

    yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the goal loop never finished", "30 seconds")

    const users = yield* userTexts(chat.id)
    expect(users).toHaveLength(2)
    expect(users[1]).toContain("Goal: make the tests pass")
    expect(users[1]).toContain("the tests were not run")

    const goal = yield* goals.get(chat.id)
    expect(goal?.status).toBe("done")
    expect(goal?.turns.used).toBe(2)
    expect(goal?.last?.verdict).toBe("done")

    const guards = yield* SessionGuardLog.Service
    const trips = (yield* guards.recent()).filter((t) => t.guard === "goal")
    expect(trips.map((t) => t.action).sort()).toEqual(["correct", "stop"])
  }),
)

it.instance(
  "a Plan-only goal records the real plan and finishes without Build approval",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => providerCfg(url))
      const { chat, goals, prompt, sessions } = yield* startGoal("Prepare the implementation plan", {
        agent: "plan",
        maxTurns: 3,
      })
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Bun.write(Session.plan(chat, instance), "# Plan\nChange src/index.ts and verify with bun test."),
      )
      yield* llm.textMatch(judgeRequest, verdict("done", "The recorded plan covers the request"))
      yield* llm.tool("plan_exit", {})
      yield* llm.text("The plan is ready for review.")
      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "Plan-only goal did not finish", "30 seconds")
      expect((yield* goals.get(chat.id))?.status).toBe("done")
      const messages = yield* sessions.messages({ sessionID: chat.id })
      expect(messages.filter((message) => message.info.role === "user").map((message) => message.info.agent)).toEqual([
        "plan",
      ])
      expect(JSON.stringify(messages)).toContain("Plan-only goal: revision")
      const plans = yield* SessionPlan.Service
      expect((yield* plans.list(chat.id))[0]).toMatchObject({
        status: "ready",
        content: "# Plan\nChange src/index.ts and verify with bun test.",
      })
      const exit = messages
        .flatMap((message) => message.parts)
        .find((part) => part.type === "tool" && part.tool === "plan_exit")
      expect(exit?.type === "tool" && exit.state.status === "completed" && exit.state.metadata.agent).toBe("plan")
    }),
  30000,
)

it.instance(
  "a provider retry inside a turn spends nothing: the turn is spent once, when it is judged",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => providerCfg(url))
      const { chat, goals, prompt } = yield* startGoal("Try the provider once", { maxTurns: 1 })
      yield* llm.error(503, { error: { message: "Service temporarily unavailable", type: "server_error" } })
      yield* llm.text("Recovered on the retry")
      yield* llm.textMatch(judgeRequest, verdict("continue", "Still needs evidence"))
      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "retry did not finish", "15 seconds")
      const goal = yield* goals.get(chat.id)
      // The retry was admitted: the failed attempt had not touched the budget of one turn.
      expect((yield* llm.hits).filter((hit) => !judgeRequest(hit))).toHaveLength(2)
      expect(goal?.turns.used).toBe(1)
      expect(goal?.status).toBe("paused")
      expect(goal?.reason).toContain("running out of turns is not completion")
      expect(goal?.reason).toContain("/goal-budget")
    }),
  20000,
)

it.instance(
  "tool round-trips inside a turn spend nothing: many steps, one judged turn, one turn of the budget",
  () =>
    Effect.gen(function* () {
      const fixture = yield* useServerConfig((url) => providerCfg(url))
      const { chat, goals, prompt } = yield* startGoal("Read the reports", { maxTurns: 1 })
      const file = path.join(fixture.dir, "report.txt")
      yield* Effect.promise(() => Bun.write(file, "all green"))
      yield* fixture.llm.tool("read", { filePath: file })
      yield* fixture.llm.tool("glob", { pattern: "*.txt" })
      yield* fixture.llm.tool("glob", { pattern: "**/*.md" })
      yield* fixture.llm.text("Read everything; all green.")
      yield* fixture.llm.textMatch(judgeRequest, verdict("done", "the reports were read and are green"))
      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the goal loop never finished", "30 seconds")
      // Four provider calls, every one admitted against a budget of one turn.
      expect((yield* fixture.llm.hits).filter((hit) => !judgeRequest(hit))).toHaveLength(4)
      const goal = yield* goals.get(chat.id)
      expect(goal?.status).toBe("done")
      expect(goal?.turns.used).toBe(1)
    }),
  30000,
)

it.instance(
  "a terminal provider failure blocks the Goal before the session becomes idle",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => providerCfg(url))
      const { chat, goals, prompt } = yield* startGoal("Complete the objective", { maxTurns: 2 })
      yield* llm.error(400, { error: { message: "Invalid model request", type: "invalid_request_error" } })
      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "failure did not finish", "10 seconds")
      const goal = yield* goals.get(chat.id)
      const status = yield* SessionStatus.Service
      expect(goal?.status).toBe("blocked")
      expect(goal?.reason).toContain("Invalid model request")
      // No turn was judged, so none was spent.
      expect(goal?.turns.used).toBe(0)
      expect((yield* status.get(chat.id)).type).toBe("idle")
    }),
  20000,
)

it.instance("the turn budget ends the loop with a reason that says running out is not completion", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => providerCfg(url))
    const { chat, goals, prompt } = yield* startGoal("never done", { maxTurns: 1 })
    yield* llm.textMatch(judgeRequest, verdict("continue", "more"))
    yield* llm.text("one")
    yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the goal loop never finished", "30 seconds")
    expect(yield* userTexts(chat.id)).toHaveLength(1)
    const goal = yield* goals.get(chat.id)
    expect(goal?.status).toBe("paused")
    expect(goal?.reason).toContain("not completion")
    expect(goal?.turns.used).toBe(1)
  }),
)

it.instance("BLOCKED pauses the goal as blocked, with the judge's reason", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => providerCfg(url))
    const { chat, goals, prompt } = yield* startGoal("deploy to prod")
    yield* llm.textMatch(judgeRequest, verdict("blocked", "no credentials for prod"))
    yield* llm.text("I cannot reach prod without credentials.")
    yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the goal loop never finished", "30 seconds")
    const goal = yield* goals.get(chat.id)
    expect(goal?.status).toBe("blocked")
    expect(goal?.reason).toBe("no credentials for prod")
    expect(yield* userTexts(chat.id)).toHaveLength(1)
  }),
)

it.instance("a failing gate is more work and the judge is never asked", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => providerCfg(url))
    const { chat, goals, prompt } = yield* startGoal("make it green; gate: echo the-gate-said-no && exit 3", {
      maxTurns: 2,
    })
    yield* llm.text("first try")
    yield* llm.text("second try")
    yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the goal loop never finished", "30 seconds")
    const users = yield* userTexts(chat.id)
    expect(users).toHaveLength(2)
    expect(users[1]).toContain("did not pass")
    expect(users[1]).toContain("the-gate-said-no")
    // Two turns, no judge: every request the model answered was a turn.
    expect(yield* llm.calls).toBe(2)
    const goal = yield* goals.get(chat.id)
    expect(goal?.status).toBe("paused")
    expect(goal?.turns.used).toBe(2)
  }),
)

it.instance("goal_complete's evidence reaches the judge; a rejected claim continues", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => providerCfg(url))
    const { chat, goals, prompt } = yield* startGoal("ship the feature; gate: true", { maxTurns: 3 })
    yield* llm.textMatch(judgeRequest, verdict("continue", "the evidence covers one file, not the feature"))
    yield* llm.textMatch(judgeRequest, verdict("done", "ok"))
    yield* llm.tool("goal_complete", { evidence: "src/a.ts now exports run(); bun test src/a.test.ts: 1 pass" })
    yield* llm.text("Claimed.")
    yield* llm.text("Verified the whole feature.")
    yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the goal loop never finished", "30 seconds")
    const judged = (yield* llm.inputs).filter((body) => judgeRequest({ body }))
    expect(judged).toHaveLength(2)
    expect(JSON.stringify(judged[0])).toContain("bun test src/a.test.ts: 1 pass")
    expect(JSON.stringify(judged[1])).not.toContain("bun test src/a.test.ts: 1 pass")
    expect((yield* goals.get(chat.id))?.status).toBe("done")
  }),
)

it.instance("an unreadable judge continues, and cancel pauses the goal as interrupted", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => providerCfg(url))
    const { chat, goals, prompt } = yield* startGoal("x; gate: true", { maxTurns: 2 })
    yield* llm.textMatch(judgeRequest, "I think it is probably fine")
    yield* llm.textMatch(judgeRequest, verdict("done", "fine"))
    yield* llm.text("one")
    yield* llm.text("two")
    yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the goal loop never finished", "30 seconds")
    expect((yield* userTexts(chat.id))[1]).toContain("could not be read")
    expect((yield* goals.get(chat.id))?.status).toBe("done")

    const again = yield* startGoal("y")
    yield* again.prompt.cancel(again.chat.id)
    const paused = yield* goals.get(again.chat.id)
    expect(paused?.status).toBe("paused")
    expect(paused?.reason).toBe("interrupted")
  }),
)

it.instance("a goal driven by another process pauses instead of restarting itself", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => providerCfg(url))
    const { chat, goals, prompt } = yield* startGoal("z", { boot: "some-other-process" })
    yield* llm.text("hello")
    yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the turn never finished", "30 seconds")
    const goal = yield* goals.get(chat.id)
    expect(goal?.status).toBe("paused")
    expect(goal?.reason).toContain("new process")
    expect(yield* userTexts(chat.id)).toHaveLength(1)
    expect(yield* llm.calls).toBe(1)
  }),
)

it.instance(
  "a budget change landing while the judge decides is not lost: the turn is recorded against the fresh record",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => providerCfg(url))
      const { chat, goals, prompt } = yield* startGoal("hold the line; gate: true", { maxTurns: 1 })
      const thinking = defer<void>()
      // The first judgement waits for the test; /goal-budget lands while it does.
      yield* llm.pushMatch(judgeRequest, reply().wait(thinking.promise).text(verdict("continue", "not yet")).stop())
      yield* llm.textMatch(judgeRequest, verdict("done", "now it holds"))
      yield* llm.text("one")
      yield* llm.text("two")
      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(
        Effect.gen(function* () {
          while (!(yield* llm.hits).some(judgeRequest)) yield* Effect.sleep("20 millis")
        }),
        "the judge was never asked",
        "20 seconds",
      )
      const during = yield* goals.get(chat.id)
      expect(during?.status).toBe("active")
      yield* goals.set(chat.id, { ...during!, turns: { ...during!.turns, max: 3 }, updated: during!.updated + 1 })
      thinking.resolve()
      yield* awaitWithTimeout(Fiber.await(fiber), "the goal loop never finished", "30 seconds")
      // Under the old budget this turn was the last; under the raised one it is a CONTINUE, and
      // the second turn is judged done. Losing the race used to record nothing and leave the
      // goal active on an idle session.
      const goal = yield* goals.get(chat.id)
      expect(goal?.status).toBe("done")
      expect(goal?.turns.max).toBe(3)
      expect(goal?.turns.used).toBe(2)
      expect(yield* userTexts(chat.id)).toHaveLength(2)
    }),
  60_000,
)

it.instance(
  "the step ceiling pauses the goal with the ceiling as its reason instead of leaving it active",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => ({
        ...providerCfg(url),
        experimental: { turn_steps: { stop_at: 3, wrap_up_at: 2 } },
      }))
      const { chat, goals, prompt } = yield* startGoal("keep going")
      // Never finishing on its own: only the ceiling ends this turn, before any judge runs.
      yield* llm.tool("glob", { pattern: "**/*.nothing" })
      yield* llm.tool("glob", { pattern: "**/*.nowhere" })
      yield* llm.text("never reached")
      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the turn never finished", "30 seconds")
      const goal = yield* goals.get(chat.id)
      expect(goal?.status).toBe("paused")
      expect(goal?.reason).toContain("step ceiling")
      expect(goal?.turns.used).toBe(0)
      expect((yield* llm.hits).some(judgeRequest)).toBe(false)
    }),
  60_000,
)

it.instance(
  "a stalled turn pauses the goal with the stall as its reason",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => ({
        ...providerCfg(url),
        experimental: { turn_stall: { warn_ms: 500, abort_ms: 1500 } },
      }))
      const { chat, goals, prompt } = yield* startGoal("wait for a provider that never answers")
      yield* llm.hang
      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      yield* awaitWithTimeout(llm.wait(1), "the provider was never called", "20 seconds")
      // No cancel of our own: the watchdog is the only thing that can end this.
      const exit = yield* awaitWithTimeout(Fiber.await(fiber), "watchdog never ended the stalled turn", "20 seconds")
      expect(Exit.isSuccess(exit)).toBe(true)
      const goal = yield* goals.get(chat.id)
      expect(goal?.status).toBe("paused")
      expect(goal?.reason).toMatch(/^stalled: no output/)
    }),
  60_000,
)

it.instance(
  "a tool result from an earlier turn is not evidence for a later claim",
  () =>
    Effect.gen(function* () {
      const fixture = yield* useServerConfig((url) => providerCfg(url))
      const { chat, goals, prompt } = yield* startGoal("prove it", { maxTurns: 2 })
      const file = path.join(fixture.dir, "proof.txt")
      yield* Effect.promise(() => Bun.write(file, "proof-from-turn-one"))
      // Turn 1 reads a file and is sent back; turn 2 claims completion without touching anything.
      yield* fixture.llm.tool("read", { filePath: file })
      yield* fixture.llm.text("Looked at the proof.")
      yield* fixture.llm.textMatch(judgeRequest, verdict("continue", "reading is not doing"))
      yield* fixture.llm.text("It is done now.")
      yield* fixture.llm.textMatch(judgeRequest, verdict("done", "the agent says so"))
      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the goal loop never finished", "30 seconds")
      const judged = (yield* fixture.llm.inputs).filter((body) => judgeRequest({ body }))
      expect(judged).toHaveLength(2)
      expect(JSON.stringify(judged[0])).toContain("proof-from-turn-one")
      expect(JSON.stringify(judged[1])).not.toContain("proof-from-turn-one")
      // Nothing was executed on the second turn, so the claim is sent back — and, this being the
      // last turn of the budget, the goal is parked rather than declared done.
      const goal = yield* goals.get(chat.id)
      expect(goal?.status).toBe("paused")
      expect(goal?.reason).toContain("Completion requires an executed check")
      expect(goal?.turns.used).toBe(2)
    }),
  30000,
)

it.instance(
  "a background subagent defers judging until its report re-enters the parent",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => providerCfg(url))
      const { chat, goals, prompt, sessions } = yield* startGoal("fix the cache key; verify: bun test", { maxTurns: 5 })
      const jobs = yield* BackgroundJob.Service
      const gate = defer<void>()
      const has = (needle: string) => (hit: { body: Record<string, unknown> }) =>
        JSON.stringify(hit.body).includes(needle)

      // Turn 1: the model hands the work to a background subagent and yields.
      yield* llm.tool("task", {
        description: "fix cache key",
        prompt: "look into the cache key path",
        subagent_type: "general",
        background: true,
      })
      yield* llm.textMatch(has("Background task started"), "Launched a subagent for the cache key; waiting on it.")
      // The child answers only when the test lets it, so the parent's turn ends with the job running.
      yield* llm.pushMatch(
        has("look into the cache key path"),
        reply().wait(gate.promise).text("Fixed the key in cache.ts; bun test: 12 pass.").stop(),
      )
      // Turn 2 is the child's report re-entering the parent.
      yield* llm.textMatch(has("Background task completed"), "The subagent fixed it and the tests pass.")
      yield* llm.textMatch(judgeRequest, verdict("done", "cache.ts changed and bun test shows 12 pass"))

      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "the first turn never ended", "30 seconds")

      const parked = yield* goals.get(chat.id)
      expect(parked?.status).toBe("active")
      expect(parked?.last).toBeUndefined()
      // A turn that ends waiting on background work spends nothing.
      expect(parked?.turns.used).toBe(0)
      expect((yield* llm.inputs).filter((body) => judgeRequest({ body }))).toHaveLength(0)
      const running = (yield* jobs.list()).filter((job) => job.metadata?.["parentSessionId"] === chat.id)
      expect(running).toHaveLength(1)

      // The child was told what the whole is for, ahead of its own task.
      const [child] = yield* sessions.children(chat.id)
      expect(child).toBeDefined()
      const childUsers = yield* userTexts(child!.id)
      expect(childUsers[0]).toContain("Objective: fix the cache key")
      expect(childUsers[0]).toContain("look into the cache key path")

      gate.resolve()
      const settled = yield* awaitWithTimeout(
        Effect.gen(function* () {
          while (true) {
            const goal = yield* goals.get(chat.id)
            if (goal?.status !== "active") return goal
            yield* Effect.sleep("50 millis")
          }
        }),
        "the goal never settled after the subagent reported",
        "30 seconds",
      )
      expect(settled?.status).toBe("done")
      expect(settled?.last?.verdict).toBe("done")
      expect((yield* llm.inputs).filter((body) => judgeRequest({ body }))).toHaveLength(1)

      const users = yield* userTexts(chat.id)
      expect(users.some((text) => text.includes("Background task completed"))).toBe(true)
      const guards = yield* SessionGuardLog.Service
      const trips = (yield* guards.recent()).filter((t) => t.guard === "goal")
      expect(trips.map((t) => t.action)).toEqual(["stop"])
    }),
  60_000,
)

it.instance(
  "every subtask on a message runs, together, and their results land in the order they were asked",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => providerCfg(url))
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const jobs = yield* BackgroundJob.Service
      const chat = yield* sessions.create({ title: "Fan-out" })
      const msg = yield* user(chat.id, "split the work")
      const names = ["alpha", "beta", "gamma"]
      const gates = names.map(() => defer<void>())
      for (const [i, name] of names.entries()) {
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: chat.id,
          type: "subtask",
          prompt: `job ${name}`,
          description: `task ${name}`,
          agent: "general",
          model: ref,
        })
        yield* llm.pushMatch(
          (hit) => JSON.stringify(hit.body).includes(`job ${name}`),
          reply().wait(gates[i]!.promise).text(`${name} done`).stop(),
        )
      }
      yield* llm.text("all three reported")

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      const running = yield* pollWithTimeout(
        Effect.gen(function* () {
          const list = (yield* jobs.list()).filter(
            (job) => job.metadata?.["parentSessionId"] === chat.id && job.status === "running",
          )
          if (list.length === 3) return list
        }),
        "the three subtasks never ran together",
      )
      expect(running).toHaveLength(3)
      // Finished out of order on purpose: the transcript keeps the order they were asked in.
      for (const gate of [...gates].reverse()) gate.resolve()
      yield* awaitWithTimeout(Fiber.join(fiber), "the loop never finished", "30 seconds")

      const msgs = yield* sessions.messages({ sessionID: chat.id })
      const outputs = msgs
        .filter((m) => m.info.role === "assistant" && m.info.agent === "general")
        .flatMap((m) =>
          m.parts.flatMap((p) => (p.type === "tool" && p.state.status === "completed" ? [p.state.output] : [])),
        )
      expect(outputs).toHaveLength(3)
      expect(outputs.map((o) => names.find((n) => o.includes(`${n} done`)))).toEqual(names)
      expect(yield* llm.calls).toBe(4)
    }),
  60_000,
)

it.instance(
  "Plan provider requests hydrate approved Design absent from the transcript",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => providerCfg(url))
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service
      const studio = yield* DesignStudio.Service
      const chat = yield* sessions.create({ agent: "plan", title: "Payment plan" })
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "plan",
        noReply: true,
        parts: [{ type: "text", text: "Continue planning" }],
      })
      yield* studio.use(
        Effect.gen(function* () {
          const store = yield* DesignStore.Service
          const document = yield* store.create(chat.id, {
            name: "Payment",
            engine: "html",
            journey: "new",
            kind: "screen",
          })
          yield* store.update(document.id, {
            decisions: [{ id: "retry", text: "Keep transaction key on every retry" }],
          })
          const revision = yield* store.publish(document.id, "Approved payment")
          yield* store.approve(document.id, revision.id)
          yield* store.reopen(document.id)
          yield* store.update(document.id, {
            decisions: [{ id: "retry", text: "UNAPPROVED: discard transaction key" }],
          })
          yield* store.publish(document.id, "Draft payment")
        }),
      )
      yield* llm.text("The implementation plan is ready for review.")
      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "Plan request did not finish", "30 seconds")
      const hits = yield* llm.hits
      expect(hits.length).toBeGreaterThan(0)
      expect(JSON.stringify(hits.map((hit) => hit.body))).toContain("Keep transaction key on every retry")
      expect(JSON.stringify(hits.map((hit) => hit.body))).not.toContain("UNAPPROVED: discard transaction key")
      expect(JSON.stringify(yield* sessions.messages({ sessionID: chat.id }))).not.toContain(
        "Keep transaction key on every retry",
      )
    }),
  30000,
)

it.instance(
  "Plan explains its writable file and recovers from plan_exit before the file exists",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => providerCfg(url))
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service
      const chat = yield* sessions.create({ agent: "plan", title: "Missing plan" })
      const instance = yield* InstanceState.context
      const file = Session.plan(chat, instance)
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "plan",
        noReply: true,
        parts: [{ type: "text", text: "Prepare the implementation" }],
      })
      yield* llm.tool("plan_exit", {})
      yield* llm.text("I will save the plan before asking for approval.")
      yield* awaitWithTimeout(prompt.loop({ sessionID: chat.id }), "Plan failed to recover", "30 seconds")
      const messages = yield* sessions.messages({ sessionID: chat.id })
      const part = messages
        .flatMap((item) => item.parts)
        .find((part) => part.type === "tool" && part.tool === "plan_exit")
      if (part?.type !== "tool" || part.state.status !== "error")
        throw new Error("Expected a recoverable plan_exit error")
      expect(part.state.error).toContain("Plan file not found")
      expect(part.state.error).toContain(file)
      const requests = JSON.stringify(yield* llm.inputs)
      expect(requests).toContain("permitted editing surface")
      expect(requests).not.toContain("ZERO exceptions")
      expect((yield* sessions.get(chat.id)).agent).toBe("plan")
    }),
  30000,
)

it.instance(
  "Plan writes its permitted file, asks for approval and continues in Build with the recorded plan",
  () =>
    Effect.gen(function* () {
      const { llm } = yield* useServerConfig((url) => ({ ...providerCfg(url), agent: { build: { steps: 3 } } }))
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service
      const questions = yield* Question.Service
      const plans = yield* SessionPlan.Service
      const chat = yield* sessions.create({ agent: "plan", title: "Approved plan" })
      const instance = yield* InstanceState.context
      const file = Session.plan(chat, instance)
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "plan",
        variant: "high",
        noReply: true,
        parts: [{ type: "text", text: "Plan an idempotent payment endpoint" }],
      })
      const content = "# Plan\nPreserve the transaction key on payment retries. Verify duplicate requests charge once."
      yield* llm.tool("write", { filePath: file, content })
      yield* llm.tool("plan_exit", {
        tasks: [
          {
            key: "implement",
            content: "Execute the reviewed plan",
            criterion: "Requested behavior verified",
            quote: content.slice(7),
          },
        ],
      })
      yield* llm.text("Implementing the approved payment plan.")
      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
      const question = yield* pollWithTimeout(
        questions.list().pipe(Effect.map((items) => items.find((item) => item.sessionID === chat.id))),
        "Plan approval never opened",
        "15 seconds",
      ).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const permissions = yield* Permission.Service
            const pending = yield* permissions.list()
            const messages = yield* sessions.messages({ sessionID: chat.id })
            return yield* Effect.fail(
              new Error(
                `${error.message}: ${JSON.stringify({
                  permissions: pending.filter((item) => item.sessionID === chat.id),
                  tools: messages.flatMap((item) => item.parts).filter((part) => part.type === "tool"),
                })}`,
              ),
            )
          }),
        ),
      )
      expect(question.questions[0].question).toContain(content)
      expect((yield* plans.list(chat.id))[0].status).toBe("ready")
      yield* questions.reply({ requestID: question.id, answers: [["Yes"]] })
      yield* awaitWithTimeout(Fiber.join(fiber), "Approved plan never reached Build", "30 seconds")
      expect((yield* plans.list(chat.id))[0]).toMatchObject({ content, status: "approved" })
      const todos = yield* Todo.Service
      expect(yield* todos.get(chat.id)).toMatchObject([
        { source: { type: "plan", key: "implement" }, criterion: "Requested behavior verified" },
      ])
      const messages = yield* sessions.messages({ sessionID: chat.id })
      expect(messages.at(-1)?.info).toMatchObject({ role: "assistant", agent: "build" })
      expect((yield* sessions.get(chat.id)).agent).toBe("build")
      expect((yield* sessions.get(chat.id)).model?.variant).toBe("high")
      expect(JSON.stringify((yield* llm.inputs).at(-1))).toContain(content.slice(7))
    }),
  30000,
)

for (const outcome of ["reject", "change", "remove"] as const) {
  it.instance(
    `Plan approval ${outcome} keeps the session in Plan and never authorizes changed content`,
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig((url) => providerCfg(url))
        const sessions = yield* Session.Service
        const prompt = yield* SessionPrompt.Service
        const questions = yield* Question.Service
        const plans = yield* SessionPlan.Service
        const chat = yield* sessions.create({ agent: "plan", title: "Review plan safely" })
        const instance = yield* InstanceState.context
        const file = Session.plan(chat, instance)
        const content = "# Plan\nReview before implementation."
        yield* Effect.promise(() => Bun.write(file, content))
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "plan",
          noReply: true,
          parts: [{ type: "text", text: "Review my implementation plan" }],
        })
        yield* llm.tool("plan_exit", {
          tasks: [
            {
              key: "implement",
              content: "Execute the reviewed plan",
              criterion: "Requested behavior verified",
              quote: content.slice(7),
            },
          ],
        })
        yield* llm.text("Continuing to refine the plan.")
        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        const question = yield* pollWithTimeout(
          questions.list().pipe(Effect.map((items) => items.find((item) => item.sessionID === chat.id))),
          "Plan approval never opened",
          "15 seconds",
        )
        if (outcome === "change") yield* Effect.promise(() => Bun.write(file, "UNAPPROVED REPLACEMENT"))
        if (outcome === "remove") yield* Effect.promise(() => Bun.file(file).delete())
        yield* questions.reply({ requestID: question.id, answers: [[outcome === "reject" ? "No" : "Yes"]] })
        yield* awaitWithTimeout(Fiber.join(fiber), "Plan did not recover from the approval outcome", "30 seconds")
        expect((yield* plans.list(chat.id))[0]).toMatchObject({ content, status: "ready" })
        expect((yield* sessions.get(chat.id)).agent).toBe("plan")
        const messages = yield* sessions.messages({ sessionID: chat.id })
        expect(messages.at(-1)?.info).toMatchObject({ role: "assistant", agent: "plan" })
        const part = messages
          .flatMap((item) => item.parts)
          .find((part) => part.type === "tool" && part.tool === "plan_exit")
        if (part?.type !== "tool" || part.state.status !== "error")
          throw new Error("Expected plan_exit to reject the transition")
        if (outcome === "change") expect(part.state.error).toContain("Plan changed during approval")
        if (outcome === "remove") expect(part.state.error).toContain("Plan file not found")
      }),
    30000,
  )
}

// Context epochs: the durable baseline system context and its mid-conversation updates.

const bodyMessages = (hit: { body: Record<string, unknown> }) => {
  const list = hit.body.messages
  return Array.isArray(list) ? (list as Array<{ role: string; content: unknown }>) : []
}

const bodySystem = (hit: { body: Record<string, unknown> }) =>
  bodyMessages(hit)
    .filter((message) => message.role === "system")
    .map((message) => message.content)

const epochRows = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return yield* db
      .select()
      .from(SessionContextEpochTable)
      .where(eq(SessionContextEpochTable.session_id, sessionID))
      .all()
  })

const systemRows = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return yield* db
      .select()
      .from(SessionMessageTable)
      .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "system")))
      .all()
  })

// Swaps the read tool for one that rewrites AGENTS.md while the turn is between provider steps.
const rewriteOnRead = (file: string, text: string) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const { read } = yield* registry.named()
    const original = read.execute
    read.execute = () =>
      Effect.promise(() => Bun.write(file, text)).pipe(
        Effect.as({
          title: "AGENTS.md",
          metadata: { preview: text, truncated: false, loaded: [] },
          output: "rewritten",
        }),
      )
    yield* Effect.addFinalizer(() => Effect.sync(() => void (read.execute = original)))
  })

it.instance("a tool step and the stop after it send one durable baseline system context", () =>
  Effect.gen(function* () {
    const { dir, llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Epoch" })
    const file = path.join(dir, "notes.txt")
    yield* writeText(file, "some notes")
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "read the notes" }],
    })
    yield* llm.tool("read", { filePath: file })
    yield* llm.text("done")

    yield* prompt.loop({ sessionID: chat.id })

    const hits = yield* llm.hits
    expect(hits.length).toBe(2)
    expect(bodySystem(hits[1]!)).toEqual(bodySystem(hits[0]!))
    const epochs = yield* epochRows(chat.id)
    expect(epochs).toHaveLength(1)
    expect(JSON.stringify(bodySystem(hits[0]!))).toContain(JSON.stringify(epochs[0]!.baseline).slice(1, -1))
    // The parts the legacy loop used to assemble per step are all in the durable baseline.
    expect(epochs[0]!.baseline).toContain("<env>")
    expect(epochs[0]!.baseline).toContain(`Working directory: ${dir}`)
    expect(epochs[0]!.baseline).toContain("Skills provide specialized instructions")
    // The selected model stays a per-turn line, ahead of the baseline.
    expect(JSON.stringify(bodySystem(hits[0]!))).toContain("You are powered by the model named test-model")
    // The request opens with the agent prompt, the model line and the baseline, verbatim.
    const providers = yield* ProviderSvc.Service
    const agents = yield* AgentSvc.Service
    const model = yield* providers.getModel(ref.providerID, ref.modelID)
    const build = yield* agents.get("build")
    const header = build?.prompt ? [build.prompt] : SystemPrompt.provider(model)
    expect(String(bodySystem(hits[0]!)[0])).toStartWith(
      [...header, SystemPrompt.identity(model), epochs[0]!.baseline].join("\n"),
    )
  }),
)

it.instance("an instruction change between steps keeps the baseline and admits one system update", () =>
  Effect.gen(function* () {
    const { dir, llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const agents = path.join(dir, "AGENTS.md")
    yield* writeText(agents, "Be terse.")
    yield* rewriteOnRead(agents, "Always answer in haiku.")
    const chat = yield* sessions.create({ title: "Epoch" })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "read the instructions" }],
    })
    yield* llm.tool("read", { filePath: agents })
    yield* llm.text("done")

    yield* prompt.loop({ sessionID: chat.id })

    const hits = yield* llm.hits
    expect(hits.length).toBe(2)
    // The cached prefix survives the change: the second request sends the same system text.
    expect(bodySystem(hits[1]!)).toEqual(bodySystem(hits[0]!))
    expect(JSON.stringify(bodySystem(hits[0]!))).toContain("Be terse.")
    expect(JSON.stringify(bodySystem(hits[1]!))).not.toContain("Always answer in haiku.")
    expect(yield* systemRows(chat.id)).toHaveLength(1)
    // The change reaches the model once, as a wrapped update after the assistant's tool step.
    const messages = bodyMessages(hits[1]!)
    const update = messages.findIndex((message) => JSON.stringify(message).includes("<system_update>"))
    const assistant = messages.findLastIndex((message) => message.role === "assistant")
    expect(update).toBeGreaterThan(assistant)
    expect(messages[update]!.role).toBe("user")
    expect(JSON.stringify(messages[update])).toContain(
      "These instructions replace all previously loaded ambient instructions",
    )
    expect(JSON.stringify(messages[update])).toContain("Always answer in haiku.")
    expect(JSON.stringify(bodyMessages(hits[0]!))).not.toContain("<system_update>")
  }),
)

it.instance("switching agents mid-turn admits one skill-guidance update and keeps the baseline", () =>
  Effect.gen(function* () {
    // Plan is denied skills here, so the switch changes what the model may be told about them.
    const { llm } = yield* useServerConfig((url) => ({
      ...providerCfg(url),
      agent: { plan: { permission: { skill: "deny" } } },
    }))
    const gate = yield* Deferred.make<void>()
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Epoch" })
    yield* llm.hold("first", deferredAsPromise(gate))
    yield* llm.text("second")

    const first = yield* prompt
      .prompt({ sessionID: chat.id, agent: "build", model: ref, parts: [{ type: "text", text: "first" }] })
      .pipe(Effect.forkChild)
    yield* llm.wait(1)
    yield* waitForBusy(chat.id)
    const id = MessageID.ascending()
    const second = yield* prompt
      .prompt({
        sessionID: chat.id,
        messageID: id,
        agent: "plan",
        model: ref,
        parts: [{ type: "text", text: "plan it" }],
      })
      .pipe(Effect.forkChild)
    yield* pollWithTimeout(
      sessions
        .messages({ sessionID: chat.id })
        .pipe(
          Effect.map((msgs) => (msgs.some((msg) => msg.info.role === "user" && msg.info.id === id) ? true : undefined)),
        ),
      "timed out waiting for the second prompt to save",
    )
    yield* Deferred.succeed(gate, void 0)
    yield* Effect.all([Fiber.await(first), Fiber.await(second)])

    const hits = yield* llm.hits
    expect(hits.length).toBe(2)
    const epochs = yield* epochRows(chat.id)
    expect(epochs).toHaveLength(1)
    expect(JSON.stringify(bodySystem(hits[1]!))).toContain(JSON.stringify(epochs[0]!.baseline).slice(1, -1))
    const rows = yield* systemRows(chat.id)
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows[0]!.data)).toContain("Previously listed skills are no longer available.")
    expect(JSON.stringify(bodyMessages(hits[1]!))).toContain("Previously listed skills are no longer available.")
  }),
)

it.instance("compaction starts a new epoch and leaves earlier system updates behind", () =>
  Effect.gen(function* () {
    const { dir, llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const compaction = yield* SessionCompaction.Service
    const agents = path.join(dir, "AGENTS.md")
    yield* writeText(agents, "Be terse.")
    yield* rewriteOnRead(agents, "Always answer in haiku.")
    const chat = yield* sessions.create({ title: "Epoch" })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "read the instructions and then tell me at length what they say" }],
    })
    yield* llm.tool("read", { filePath: agents })
    yield* llm.text("The instructions say to be terse, which I will honour from now on in every reply.")
    yield* prompt.loop({ sessionID: chat.id })
    const before = yield* epochRows(chat.id)
    expect(before).toHaveLength(1)
    expect(yield* systemRows(chat.id)).toHaveLength(1)

    yield* compaction.create({ sessionID: chat.id, agent: "build", model: ref, auto: false })
    yield* llm.text("Summary.")
    yield* prompt.loop({ sessionID: chat.id })
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "next" }] })
    yield* llm.text("ok")
    yield* prompt.loop({ sessionID: chat.id })

    const after = yield* epochRows(chat.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.baseline_seq).toBeGreaterThan(before[0]!.baseline_seq)
    // The new baseline already carries the rewritten instructions, so the old update is not replayed.
    expect(after[0]!.baseline).toContain("Always answer in haiku.")
    const hits = yield* llm.hits
    const last = hits[hits.length - 1]!
    expect(JSON.stringify(bodySystem(last))).toContain("Always answer in haiku.")
    expect(JSON.stringify(bodyMessages(last))).not.toContain("<system_update>")
    expect(JSON.stringify(bodyMessages(hits[1]!))).toContain("<system_update>")
  }),
)

it.instance("a restarted runtime reuses the stored baseline verbatim", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const database = yield* Database.Service
    const chat = yield* sessions.create({ title: "Epoch" })
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "one" }] })
    yield* llm.text("first")
    yield* prompt.loop({ sessionID: chat.id })
    const epochs = yield* epochRows(chat.id)
    expect(epochs).toHaveLength(1)
    // A marker only the stored row carries: a runtime that re-rendered the baseline would lose it.
    yield* database.db
      .update(SessionContextEpochTable)
      .set({
        baseline: `${epochs[0]!.baseline}

STORED BASELINE MARKER`,
      })
      .where(eq(SessionContextEpochTable.session_id, chat.id))
      .run()

    // A second service graph on the same database, the way a restarted process would build one.
    const restarted = yield* Layer.build(
      AppNodeBuilder.build(LayerNode.group([promptRoot, testLLMServerNode]), [
        [SessionSummary.node, summary],
        [LSP.node, lsp],
        [MCP.node, makeMcp()],
        [RuntimeFlags.node, runtimeFlags],
        [Database.node, Layer.succeed(Database.Service, database)],
        [testLLMServerNode, Layer.succeed(TestLLMServer, llm)],
      ]),
    )
    const again = Context.get(restarted, SessionPrompt.Service)
    yield* again.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "two" }] })
    yield* llm.text("second")
    yield* again.loop({ sessionID: chat.id })

    const hits = yield* llm.hits
    expect(hits.length).toBe(2)
    expect(JSON.stringify(bodySystem(hits[1]!))).toContain("STORED BASELINE MARKER")
    expect(yield* epochRows(chat.id)).toHaveLength(1)
    expect(yield* systemRows(chat.id)).toHaveLength(0)
  }),
)

brokenMcp.instance("a failing MCP service ends the turn instead of being read as an empty source", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Epoch" })
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "hi" }] })
    yield* llm.text("never sent")

    const exit = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("mcp exploded")
    expect(yield* llm.hits).toHaveLength(0)
    expect(yield* epochRows(chat.id)).toHaveLength(0)
  }),
)

it.instance("a summary committed by a run that died right after it still starts a new epoch", () =>
  Effect.gen(function* () {
    // The crash window: compaction commits its summary and the process is gone before the loop
    // runs anything after it. The next turn must not read the summary under the old baseline or
    // replay the system updates admitted before it.
    const { dir, llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const compaction = yield* SessionCompaction.Service
    const database = yield* Database.Service
    const agents = path.join(dir, "AGENTS.md")
    yield* writeText(agents, "Be terse.")
    yield* rewriteOnRead(agents, "Always answer in haiku.")
    const chat = yield* sessions.create({ title: "Epoch" })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "read the instructions and then tell me at length what they say" }],
    })
    yield* llm.tool("read", { filePath: agents })
    yield* llm.text("The instructions say to be terse, which I will honour from now on in every reply.")
    yield* prompt.loop({ sessionID: chat.id })
    const before = yield* epochRows(chat.id)
    expect(before).toHaveLength(1)
    expect(yield* systemRows(chat.id)).toHaveLength(1)

    yield* compaction.create({ sessionID: chat.id, agent: "build", model: ref, auto: false })
    const messages = yield* MessageV2.filterCompactedEffect(chat.id).pipe(
      Effect.provideService(Database.Service, database),
    )
    const parent = messages.findLast((message) => message.info.role === "user")
    yield* llm.text("Summary.")
    expect(yield* compaction.process({ messages, parentID: parent!.info.id, sessionID: chat.id, auto: false })).toBe(
      "continue",
    )
    const summary = (yield* sessions.messages({ sessionID: chat.id })).findLast(
      (message) => message.info.role === "assistant" && message.info.summary === true,
    )
    expect(summary?.info.role === "assistant" ? summary.info.finish : undefined).toBe("stop")

    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "next" }] })
    yield* llm.text("ok")
    yield* prompt.loop({ sessionID: chat.id })

    const after = yield* epochRows(chat.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.baseline_seq).toBeGreaterThan(before[0]!.baseline_seq)
    expect(after[0]!.baseline).toContain("Always answer in haiku.")
    const hits = yield* llm.hits
    expect(JSON.stringify(bodyMessages(hits[hits.length - 1]!))).not.toContain("<system_update>")
  }),
)

it.instance("an unreadable stored snapshot starts a new epoch instead of ending every turn", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const database = yield* Database.Service
    const chat = yield* sessions.create({ title: "Epoch" })
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "one" }] })
    yield* llm.text("first")
    yield* prompt.loop({ sessionID: chat.id })
    const before = yield* epochRows(chat.id)
    expect(before).toHaveLength(1)
    yield* database.db
      .update(SessionContextEpochTable)
      .set({ snapshot: { invalid: { value: "bad" } } })
      .where(eq(SessionContextEpochTable.session_id, chat.id))
      .run()

    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "two" }] })
    yield* llm.text("second")
    const result = yield* prompt.loop({ sessionID: chat.id })

    expect(result.info.role === "assistant" ? result.info.error : undefined).toBeUndefined()
    expect(result.parts).toContainEqual(expect.objectContaining({ type: "text", text: "second" }))
    const after = yield* epochRows(chat.id)
    expect(after).toHaveLength(1)
    expect(Object.keys(after[0]!.snapshot)).not.toContain("invalid")
    expect(after[0]!.baseline_seq).toBeGreaterThan(before[0]!.baseline_seq)
    expect(JSON.stringify(bodySystem((yield* llm.hits)[1]!))).toContain(JSON.stringify(after[0]!.baseline).slice(1, -1))
  }),
)

it.instance("a revert ends the epoch with the history it removes", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Epoch" })
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "one" }] })
    yield* llm.text("first")
    const first = yield* prompt.loop({ sessionID: chat.id })
    const before = yield* epochRows(chat.id)
    expect(before).toHaveLength(1)
    yield* sessions.setRevert({
      sessionID: chat.id,
      revert: { messageID: first.info.id },
      summary: { additions: 0, deletions: 0, files: 0 },
    })

    // The next prompt commits the staged revert before the turn starts.
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "two" }] })
    expect(yield* epochRows(chat.id)).toHaveLength(0)
    yield* llm.text("second")
    yield* prompt.loop({ sessionID: chat.id })

    const after = yield* epochRows(chat.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.baseline_seq).toBeGreaterThan(before[0]!.baseline_seq)
  }),
)

flaky.instance("a source unavailable after compaction blocks the replacement until it is observable again", () =>
  Effect.gen(function* () {
    const { dir, llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const compaction = yield* SessionCompaction.Service
    const agents = path.join(dir, "AGENTS.md")
    yield* writeText(agents, "Be terse.")
    yield* rewriteOnRead(agents, "Always answer in haiku.")
    flakySource.value = "FLAKY SOURCE TEXT"
    const chat = yield* sessions.create({ title: "Epoch" })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "read the instructions and then tell me at length what they say" }],
    })
    yield* llm.tool("read", { filePath: agents })
    yield* llm.text("The instructions say to be terse, which I will honour from now on in every reply.")
    yield* prompt.loop({ sessionID: chat.id })
    const before = yield* epochRows(chat.id)
    expect(before).toHaveLength(1)
    expect(before[0]!.baseline).toContain("FLAKY SOURCE TEXT")
    expect(before[0]!.replacement_seq).toBeNull()
    expect(yield* systemRows(chat.id)).toHaveLength(1)

    // The source admitted into the baseline cannot be observed when the compaction ends the epoch.
    flakySource.value = SystemContext.unavailable
    yield* compaction.create({ sessionID: chat.id, agent: "build", model: ref, auto: false })
    yield* llm.text("Summary.")
    yield* prompt.loop({ sessionID: chat.id })
    const requested = yield* epochRows(chat.id)
    expect(requested[0]!.replacement_seq).toBeGreaterThan(before[0]!.baseline_seq)
    expect(requested[0]!.baseline).toBe(before[0]!.baseline)

    // Blocked: the turn runs under the stored baseline and snapshot, with its earlier update
    // still replayed, nothing new is admitted, and the request stays pending.
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "next" }] })
    yield* llm.text("ok")
    const blocked = yield* prompt.loop({ sessionID: chat.id })
    expect(blocked.info.role === "assistant" ? blocked.info.error : undefined).toBeUndefined()
    expect(blocked.parts).toContainEqual(expect.objectContaining({ type: "text", text: "ok" }))
    const during = yield* epochRows(chat.id)
    expect(during).toEqual(requested)
    expect(yield* systemRows(chat.id)).toHaveLength(1)
    const hits = yield* llm.hits
    expect(hits).toHaveLength(4)
    expect(JSON.stringify(bodySystem(hits[3]!))).toContain(JSON.stringify(before[0]!.baseline).slice(1, -1))
    expect(JSON.stringify(bodyMessages(hits[3]!))).toContain("<system_update>")

    // Observable again: the next boundary renders the fresh baseline at the requested sequence.
    flakySource.value = "FLAKY SOURCE TEXT"
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "again" }],
    })
    yield* llm.text("fine")
    yield* prompt.loop({ sessionID: chat.id })
    const after = yield* epochRows(chat.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.baseline_seq).toBe(requested[0]!.replacement_seq!)
    expect(after[0]!.replacement_seq).toBeNull()
    expect(after[0]!.baseline).toContain("Always answer in haiku.")
    expect(after[0]!.baseline).toContain("FLAKY SOURCE TEXT")
    const last = (yield* llm.hits)[4]!
    expect(JSON.stringify(bodySystem(last))).toContain(JSON.stringify(after[0]!.baseline).slice(1, -1))
    expect(JSON.stringify(bodyMessages(last))).not.toContain("<system_update>")
  }),
)

it.instance("a restart between a compaction and the next turn still replaces the epoch", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const compaction = yield* SessionCompaction.Service
    const database = yield* Database.Service
    const chat = yield* sessions.create({ title: "Epoch" })
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "one" }] })
    yield* llm.text("first")
    yield* prompt.loop({ sessionID: chat.id })
    const before = yield* epochRows(chat.id)
    expect(before).toHaveLength(1)
    yield* compaction.create({ sessionID: chat.id, agent: "build", model: ref, auto: false })
    yield* llm.text("Summary.")
    yield* prompt.loop({ sessionID: chat.id })
    // The request is durable on the epoch row, not in the memory of the process that made it.
    const requested = yield* epochRows(chat.id)
    expect(requested[0]!.replacement_seq).toBeGreaterThan(before[0]!.baseline_seq)

    const restarted = yield* Layer.build(
      AppNodeBuilder.build(LayerNode.group([promptRoot, testLLMServerNode]), [
        [SessionSummary.node, summary],
        [LSP.node, lsp],
        [MCP.node, makeMcp()],
        [RuntimeFlags.node, runtimeFlags],
        [Database.node, Layer.succeed(Database.Service, database)],
        [testLLMServerNode, Layer.succeed(TestLLMServer, llm)],
      ]),
    )
    const again = Context.get(restarted, SessionPrompt.Service)
    yield* again.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "two" }] })
    yield* llm.text("second")
    yield* again.loop({ sessionID: chat.id })

    const after = yield* epochRows(chat.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.baseline_seq).toBe(requested[0]!.replacement_seq!)
    expect(after[0]!.replacement_seq).toBeNull()
    const hits = yield* llm.hits
    expect(hits).toHaveLength(3)
    expect(JSON.stringify(bodySystem(hits[2]!))).toContain(JSON.stringify(after[0]!.baseline).slice(1, -1))
  }),
)

it.instance("a revert during a pending replacement ends the epoch and the next turn starts a fresh one", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const compaction = yield* SessionCompaction.Service
    const chat = yield* sessions.create({ title: "Epoch" })
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "one" }] })
    yield* llm.text("first")
    const first = yield* prompt.loop({ sessionID: chat.id })
    const before = yield* epochRows(chat.id)
    yield* compaction.create({ sessionID: chat.id, agent: "build", model: ref, auto: false })
    yield* llm.text("Summary.")
    yield* prompt.loop({ sessionID: chat.id })
    expect((yield* epochRows(chat.id))[0]!.replacement_seq).toBeGreaterThan(before[0]!.baseline_seq)

    yield* sessions.setRevert({
      sessionID: chat.id,
      revert: { messageID: first.info.id },
      summary: { additions: 0, deletions: 0, files: 0 },
    })
    yield* prompt.prompt({ sessionID: chat.id, agent: "build", noReply: true, parts: [{ type: "text", text: "two" }] })
    expect(yield* epochRows(chat.id)).toHaveLength(0)
    yield* llm.text("second")
    yield* prompt.loop({ sessionID: chat.id })

    const after = yield* epochRows(chat.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.replacement_seq).toBeNull()
    expect(after[0]!.baseline_seq).toBeGreaterThan(before[0]!.baseline_seq)
    const hits = yield* llm.hits
    expect(JSON.stringify(bodySystem(hits[hits.length - 1]!))).toContain(
      JSON.stringify(after[0]!.baseline).slice(1, -1),
    )
  }),
)

it.instance("a summary prepared in the background is still reused when the epoch is replaced", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const compaction = yield* SessionCompaction.Service
    const providers = yield* ProviderSvc.Service
    const database = yield* Database.Service
    const chat = yield* sessions.create({ title: "Epoch" })
    // A summary is only accepted when it is smaller than the history it replaces plus the
    // latest request it preserves, so the earlier turn is long and the latest one short.
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "Earlier findings. ".repeat(400) }],
    })
    yield* llm.text("first")
    yield* prompt.loop({ sessionID: chat.id })
    yield* prompt.prompt({
      sessionID: chat.id,
      agent: "build",
      noReply: true,
      parts: [{ type: "text", text: "go on" }],
    })
    yield* llm.text("second")
    yield* prompt.loop({ sessionID: chat.id })
    const before = yield* epochRows(chat.id)
    expect(before).toHaveLength(1)

    // A candidate summary prepared while the turn was still short of overflow, over the history
    // exactly as the loop reads it: the candidate is reused only for a byte-identical prefix.
    const messages = yield* MessageV2.filterCompactedEffect(chat.id).pipe(
      Effect.provideService(Database.Service, database),
    )
    const parent = messages.findLast((message) => message.info.role === "user")!
    yield* llm.text("Background summary.")
    yield* compaction.prepare({
      messages,
      parentID: parent.info.id,
      sessionID: chat.id,
      auto: true,
      model: yield* providers.getModel(ref.providerID, ref.modelID),
      tokens: { input: 85_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    yield* llm.wait(3)

    yield* compaction.create({ sessionID: chat.id, agent: "build", model: ref, auto: true })
    yield* llm.text("continued")
    yield* prompt.loop({ sessionID: chat.id })

    // One background summary request, no fresh one, and the continuation under the new baseline.
    const hits = yield* llm.hits
    expect(hits).toHaveLength(4)
    const summary = (yield* sessions.messages({ sessionID: chat.id })).filter(
      (message) => message.info.role === "assistant" && message.info.summary === true,
    )
    expect(summary).toHaveLength(1)
    expect(summary[0]!.parts).toContainEqual(expect.objectContaining({ type: "text", text: "Background summary." }))
    const after = yield* epochRows(chat.id)
    expect(after).toHaveLength(1)
    expect(after[0]!.baseline_seq).toBeGreaterThan(before[0]!.baseline_seq)
    expect(after[0]!.replacement_seq).toBeNull()
    expect(JSON.stringify(bodySystem(hits[3]!))).toContain(JSON.stringify(after[0]!.baseline).slice(1, -1))
  }),
)
