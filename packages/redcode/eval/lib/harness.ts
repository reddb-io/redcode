/**
 * Drives one eval through the production legacy session loop, headless and in process.
 *
 * The layer graph is the one `test/session/prompt.test.ts` and `tool-search.test.ts` build: the
 * real SessionPrompt, processor, tools, guards, monitors and question service, with only the
 * summary and LSP services stubbed and MCP served from in-memory fake servers. The model is either
 * the scripted provider replaying a cassette, or a real `provider/model` in live mode.
 */
import fs from "node:fs"
import path from "node:path"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { DesignStudio } from "../../src/design/studio"
import { SessionPlan } from "@reddb-io/redcode-core/session/plan"
import { Database } from "@reddb-io/redcode-core/database/database"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { Ripgrep } from "@reddb-io/redcode-core/ripgrep"
import { LocationServiceMap } from "@reddb-io/redcode-core/location-services"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { MonitorRuntime } from "@/background/monitor"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { McpCatalog } from "@/mcp/catalog"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionGuardLog } from "../../src/session/guard-log"
import { GoalRuntime } from "../../src/session/goal-runtime"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { Format } from "../../src/format"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../../test/fixture/fixture"
import { EvalRecord, type Interaction, type RunRecord } from "./record"
import { ScriptedProvider, type Cassette } from "./scripted-provider"
import { EvalMcp, type Connected, type FakeServer } from "./mcp"
import type { Options } from "./options"
import { EvalPilot, type Estimate } from "./pilot"
import { SCRIPTED_PRICING } from "./pricing"

export const FIXTURES = path.join(import.meta.dir, "..", "fixtures")

export interface Budget {
  /** The agent's step ceiling for the turn. */
  readonly steps?: number
  /** Wall clock for the whole run, monitors included. */
  readonly ms?: number
}

/**
 * Something that happens after the previous turn settled, in order: MCP servers change (a
 * mid-session connect is a system context update), the session is compacted, the user speaks.
 */
export interface Turn {
  readonly mcp?: readonly FakeServer[]
  readonly compact?: boolean
  readonly prompt?: string
}

export interface Spec {
  readonly prompt: string
  /** Follow-up turns after the first prompt, all within the same budget. */
  readonly turns?: readonly Turn[]
  /**
   * A known harness bug this eval reproduces, e.g. "#253". The eval is expected to fail until the
   * fix lands; bun then reports the unexpected pass so the marker gets removed.
   */
  readonly knownFailure?: string
  /** A directory under eval/fixtures, or an absolute path, copied into the temp workspace. */
  readonly fixture?: string
  readonly files?: Readonly<Record<string, string>>
  readonly agent?: string
  readonly budget?: Budget
  /** Cassette name under eval/cassettes, or inline steps. Default: the eval name. */
  readonly cassette?: string | Cassette
  /** Chooses the answer to a question the run asks; default: the first option. */
  readonly answer?: (question: { question: string; options: string[] }) => string
  readonly mcp?: readonly FakeServer[]
  /**
   * Make the workspace a Git checkout with the fixture committed. Off by default: in a primary
   * checkout the repository guard sends the model through the worktree preflight first, which is
   * an eval of its own rather than something every task should pay for.
   */
  readonly git?: boolean
  /** Merged into the workspace's opencode.json. */
  readonly config?: Readonly<Record<string, unknown>>
}

export interface Outcome {
  readonly record: RunRecord
  readonly sessionID?: string
  readonly workspace: string
  readonly mcp: readonly Connected[]
  readonly estimate?: Estimate
  readonly messages: readonly { info: any; parts: any[] }[]
  /** Live only: one completion from a real `provider/model`, for the judge. */
  readonly complete?: (model: string, prompt: string) => Promise<string>
  /** Live only: ask the configured System One evaluator a typed question about this run. */
  readonly evaluate?: (input: Intelligence.EvaluationInput) => Promise<Intelligence.Evaluation | undefined>
}

export const DEFAULT_BUDGET = { steps: 20, ms: 120_000 } as const

// What hermetic strips from a copied workspace: project persona, instructions and skills.
const PERSONA = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md", ".claude", ".red/skills", ".redcode", ".opencode"]

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

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

// The MCP servers of the eval currently running. Evals in one process run one at a time.
const active: { servers: Connected[] } = { servers: [] }

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.sync(() => Object.fromEntries(active.servers.map((srv) => [srv.name, srv.client as any]))),
    instructions: () => Effect.succeed([]),
    tools: () =>
      Effect.sync(() => {
        const out: Record<string, MCP.McpTool> = {}
        for (const srv of active.servers)
          for (const def of srv.defs) out[McpCatalog.toolName(srv.name, def.name)] = { def, client: srv.client as any }
        return out
      }),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    reload: () => Effect.succeed({}),
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected"),
    authenticate: () => Effect.die("unexpected"),
    finishAuth: () => Effect.die("unexpected"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  } as any),
)

const root = LayerNode.group([
  Intelligence.node,
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
  MonitorRuntime.node,
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
  ToolOutputBridge.node,
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

const layers = new Map<boolean, ReturnType<typeof build>>()

function build(hermetic: boolean) {
  const flags = RuntimeFlags.layer({
    experimentalEventSystem: true,
    experimentalBackgroundSubagents: true,
    ...(hermetic
      ? { pure: true, disableExternalSkills: true, disableClaudeCodePrompt: true, disableClaudeCodeSkills: true }
      : {}),
  })
  return AppNodeBuilder.build(root, [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [RuntimeFlags.node, flags],
  ] as const)
}

function layerFor(hermetic: boolean) {
  const found = layers.get(hermetic)
  if (found) return found
  const made = build(hermetic)
  layers.set(hermetic, made)
  return made
}

export function scriptedProviderConfig(url: string) {
  return {
    scripted: {
      name: "Scripted",
      id: "scripted",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        replay: {
          id: "replay",
          name: "Scripted replay",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 200_000, output: 16_000 },
          cost: SCRIPTED_PRICING,
          options: {},
        },
      },
      options: { apiKey: "scripted", baseURL: url },
    },
  }
}

function copyFixture(spec: Spec, directory: string, hermetic: boolean) {
  if (spec.fixture) {
    const source = path.isAbsolute(spec.fixture) ? spec.fixture : path.join(FIXTURES, spec.fixture)
    if (!fs.existsSync(source)) throw new Error(`fixture not found: ${source}`)
    fs.cpSync(source, directory, { recursive: true })
  }
  for (const [file, content] of Object.entries(spec.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true })
    fs.writeFileSync(path.join(directory, file), content)
  }
  if (hermetic) for (const entry of PERSONA) fs.rmSync(path.join(directory, entry), { recursive: true, force: true })
  if (!spec.git) return
  // The fixture is the baseline commit, so snapshots and diffs show only what the run changed.
  const git = (...args: string[]) =>
    Bun.spawnSync(["git", ...args], { cwd: directory, stdout: "ignore", stderr: "ignore" })
  git("add", "-A")
  git("commit", "-q", "--no-verify", "-m", "fixture")
}

function cassetteFor(name: string, spec: Spec, options: Options): Cassette {
  if (spec.cassette && typeof spec.cassette !== "string") return spec.cassette
  const base = typeof spec.cassette === "string" ? spec.cassette : name
  return ScriptedProvider.load(options.cassette ? `${base}.${options.cassette}` : base)
}

/** Spend across one runner invocation, shared by the bun test process of every model. */
function ledger(options: Options) {
  const file = path.join(path.dirname(options.history), `spend-${options.runId}.json`)
  const read = () => {
    try {
      return Number(JSON.parse(fs.readFileSync(file, "utf8")).usd) || 0
    } catch {
      return 0
    }
  }
  return {
    spent: read,
    add: (usd: number) => {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify({ usd: read() + usd }))
    },
  }
}

export function run<A>(input: {
  name: string
  spec: Spec
  options: Options
  /** Called with the finished record while the workspace still exists. */
  inspect: (outcome: Outcome) => Promise<A>
}): Promise<A> {
  const { name, spec, options } = input
  const hermetic = options.hermetic
  const budget = { ...DEFAULT_BUDGET, ...spec.budget }
  const agent = spec.agent ?? "build"
  const scripted = options.mode === "scripted"
  const spend = ledger(options)

  const body = Effect.gen(function* () {
    const started = Date.now()
    const directory = yield* tmpdirScoped({ git: spec.git ?? false })
    let provider: ScriptedProvider.ScriptedProvider | undefined
    const connected: Connected[] = []
    const interactions: Interaction[] = []
    const vars = new Map<string, string>([["workspace", directory]])
    let resolver: (name: string) => Promise<string> = async (key) => {
      const value = vars.get(key)
      if (value === undefined) throw new Error(`unknown cassette variable {{${key}}}`)
      return value
    }

    const setup = Effect.gen(function* () {
      copyFixture(spec, directory, hermetic)
      for (const server of spec.mcp ?? []) connected.push(yield* Effect.promise(() => EvalMcp.connect(server)))
      active.servers = connected
      let providerConfig: Record<string, unknown> = {}
      let model = options.model
      if (scripted) {
        provider = ScriptedProvider.start({
          cassette: cassetteFor(name, spec, options),
          resolve: (key) => resolver(key),
        })
        providerConfig = scriptedProviderConfig(provider.url)
        model = "scripted/replay"
        const intelligence = yield* Intelligence.Service
        yield* Effect.acquireRelease(intelligence.read(), (settings) =>
          intelligence.save({ settings }).pipe(Effect.orDie),
        )
        yield* intelligence.save({
          settings: {
            enabled: true,
            reasoning: "dual",
            onboarding: "completed",
            principal: { providerID: Provider.ID.make("scripted"), id: Model.ID.make("replay") },
            evaluator: { transport: "typesafe", model: "scripted-evaluator", baseURL: provider.url },
          },
        })
      }
      if (!scripted && process.env.REDCODE_EVAL_JEV === "1") {
        const slash = model.indexOf("/")
        const intelligence = yield* Intelligence.Service
        yield* intelligence.save({
          settings: {
            enabled: true,
            reasoning: "dual",
            onboarding: "completed",
            principal: {
              providerID: Provider.ID.make(model.slice(0, slash)),
              id: Model.ID.make(model.slice(slash + 1)),
            },
            evaluator: {
              transport: "red-router",
              baseURL: process.env.REDCODE_EVAL_ROUTER_URL ?? "http://127.0.0.1:25050/v1",
              model: process.env.REDCODE_EVAL_JEV_MODEL ?? "openrouter/typesafe/jev-1.13",
            },
          },
        })
      }
      const agentSteps = { steps: budget.steps }
      const config = {
        $schema: "https://opencode.ai/config.json",
        model,
        provider: { ...providerConfig, ...((spec.config?.provider as object) ?? {}) },
        ...spec.config,
        agent: { build: agentSteps, [agent]: agentSteps, ...((spec.config?.agent as object) ?? {}) },
      }
      fs.writeFileSync(path.join(directory, "opencode.json"), JSON.stringify(config, null, 2))
    })

    const setupExit = yield* Effect.exit(setup)
    if (Exit.isFailure(setupExit)) {
      provider?.stop()
      const record = EvalRecord.build({
        eval: name,
        model: options.model,
        mode: options.pilot ? "pilot" : options.mode,
        hermetic,
        messages: [],
        guards: [],
        crash: `setup failed: ${Cause.pretty(setupExit.cause).split("\n")[0]}`,
        durationMs: Date.now() - started,
      })
      return yield* Effect.promise(() => input.inspect({ record, workspace: directory, mcp: connected, messages: [] }))
    }
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        provider?.stop()
        active.servers = []
      }),
    )

    return yield* Effect.gen(function* () {
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service
      const questions = yield* Question.Service
      const permissions = yield* Permission.Service
      const guards = yield* SessionGuardLog.Service
      const monitors = yield* MonitorRuntime.Service
      const status = yield* SessionStatus.Service
      const todos = yield* Todo.Service
      const instance = yield* InstanceState.context
      const context = yield* Effect.context<ProviderSvc.Service | Intelligence.Service>()

      const chat = yield* sessions.create({ title: `eval: ${name}`, agent })
      yield* sessions.setPermission({
        sessionID: chat.id,
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      vars.set("plan", Session.plan(chat, instance))
      resolver = async (key) => {
        const todo = key.match(/^todo\.(\d+)\.(id|revision)$/)
        if (todo) {
          const list = await Effect.runPromiseWith(context)(todos.get(chat.id))
          const item = list[Number(todo[1])]
          if (!item) throw new Error(`{{${key}}}: the session has ${list.length} todos`)
          return String(item[todo[2] as "id" | "revision"])
        }
        const value = vars.get(key)
        if (value === undefined) throw new Error(`unknown cassette variable {{${key}}}`)
        return value
      }

      // Stands in for the user: answers every question and approves every permission ask.
      const responder = yield* Effect.gen(function* () {
        const seen = new Set<string>()
        while (true) {
          for (const request of yield* questions.list()) {
            if (request.sessionID !== chat.id || seen.has(request.id)) continue
            seen.add(request.id)
            const answers = request.questions.map((item) => {
              const labels = item.options.map((option) => option.label)
              const answer = spec.answer
                ? spec.answer({ question: item.question, options: labels })
                : (labels[0] ?? "Yes")
              interactions.push({ kind: "question", subject: item.question.slice(0, 200), answer })
              return [answer]
            })
            yield* questions.reply({ requestID: request.id, answers }).pipe(Effect.ignore)
          }
          for (const request of yield* permissions.list()) {
            if (request.sessionID !== chat.id || seen.has(request.id)) continue
            seen.add(request.id)
            interactions.push({ kind: "permission", subject: request.permission, answer: "once" })
            yield* permissions.reply({ requestID: request.id, reply: "once" }).pipe(Effect.ignore)
          }
          yield* Effect.sleep("25 millis")
        }
      }).pipe(Effect.forkChild)

      const deadline = started + budget.ms
      const cost = Effect.map(
        sessions.messages({ sessionID: chat.id }),
        (messages) => EvalRecord.transcript(messages).cost,
      )
      let budgetExceeded = false
      const limit = options.budgetUsd
      const watcher =
        !scripted && limit !== undefined
          ? yield* Effect.gen(function* () {
              while (true) {
                if (spend.spent() + (yield* cost) > limit) {
                  budgetExceeded = true
                  yield* prompt.cancel(chat.id)
                  return
                }
                yield* Effect.sleep("500 millis")
              }
            }).pipe(Effect.forkChild)
          : undefined

      let crash: string | undefined
      let timedOut = false
      if (!scripted && limit !== undefined && spend.spent() >= limit) {
        crash = undefined
        budgetExceeded = true
      } else {
        const drive = Effect.gen(function* () {
          const exit = yield* prompt.loop({ sessionID: chat.id }).pipe(
            Effect.timeoutOrElse({
              duration: Math.max(1, deadline - Date.now()),
              orElse: () => Effect.sync(() => void (timedOut = true)),
            }),
            Effect.exit,
          )
          if (Exit.isFailure(exit))
            crash = `the session loop died: ${Cause.pretty(exit.cause).split("\n").slice(0, 3).join(" ")}`
          // A monitor releases the turn and resumes the session later: the turn ends when nothing
          // is left running or waiting to be delivered, and the session has been idle twice in a row.
          let quiet = 0
          while (!crash && !timedOut && quiet < 2) {
            if (Date.now() > deadline) {
              timedOut = true
              break
            }
            const list = yield* monitors.list(chat.id)
            const waiting = list.some(
              (item) => item.status === "running" || item.delivery === "pending" || item.delivery === "observed",
            )
            const idle = (yield* status.get(chat.id)).type === "idle"
            quiet = !waiting && idle ? quiet + 1 : 0
            yield* Effect.sleep("100 millis")
          }
        })
        const say = (text: string) =>
          prompt.prompt({ sessionID: chat.id, agent, noReply: true, parts: [{ type: "text", text }] }).pipe(
            Effect.exit,
            Effect.map((exit) => {
              if (Exit.isFailure(exit)) crash = `the prompt was refused: ${Cause.pretty(exit.cause).split("\n")[0]}`
            }),
          )
        yield* say(spec.prompt)
        if (!crash) yield* drive
        const compaction = yield* SessionCompaction.Service
        const modelID = scripted ? "scripted/replay" : options.model
        const slash = modelID.indexOf("/")
        for (const turn of spec.turns ?? []) {
          if (crash || timedOut) break
          if (turn.mcp) {
            for (const server of turn.mcp) connected.push(yield* Effect.promise(() => EvalMcp.connect(server)))
            active.servers = [...connected]
          }
          if (turn.compact) {
            yield* compaction.create({
              sessionID: chat.id,
              agent,
              model: { providerID: modelID.slice(0, slash) as never, modelID: modelID.slice(slash + 1) as never },
              auto: false,
            })
            yield* drive
          }
          if (turn.prompt && !crash && !timedOut) {
            yield* say(turn.prompt)
            if (!crash) yield* drive
          }
        }
        if (timedOut) yield* prompt.cancel(chat.id)
      }
      yield* Fiber.interrupt(responder)
      if (watcher) yield* Fiber.interrupt(watcher)
      if (provider?.exhausted()) crash ??= provider.exhausted()

      const messages = yield* sessions.messages({ sessionID: chat.id })
      const trips = (yield* guards.recent({ since: started })).filter((entry) => entry.sessionID === chat.id)
      const record = EvalRecord.build({
        eval: name,
        model: options.model,
        mode: options.pilot ? "pilot" : options.mode,
        hermetic,
        messages,
        guards: [...trips].reverse().map(({ guard, action, subject, detail }) => ({
          guard,
          action,
          ...(subject ? { subject } : {}),
          detail,
        })),
        crash,
        timedOut,
        budgetExceeded,
        durationMs: Date.now() - started,
        interactions,
        requests: provider?.requests() ?? [],
        monitors: (yield* monitors.list(chat.id)).map((item) => ({ id: item.id, status: item.status })),
      })
      if (!scripted && record.cost !== null) spend.add(record.cost)
      const estimate =
        options.pilot && provider && options.pricing
          ? EvalPilot.estimate(provider.exchanges(), options.pricing)
          : undefined
      // The judge reaches a real provider, so it exists only in live mode.
      const complete = scripted
        ? undefined
        : async (model: string, text: string) => {
            const slash = model.indexOf("/")
            const language = await Effect.runPromiseWith(context)(
              Effect.gen(function* () {
                const providers = yield* ProviderSvc.Service
                const found = yield* providers.getModel(model.slice(0, slash) as never, model.slice(slash + 1) as never)
                return yield* providers.getLanguage(found)
              }),
            )
            const { generateText } = await import("ai")
            return (await generateText({ model: language, prompt: text })).text
          }
      const evaluate =
        scripted || process.env.REDCODE_EVAL_JEV !== "1"
          ? undefined
          : (input: Intelligence.EvaluationInput) =>
              Effect.runPromiseWith(context)(
                Effect.gen(function* () {
                  const intelligence = yield* Intelligence.Service
                  return yield* intelligence.evaluate(input)
                }),
              )
      return yield* Effect.promise(() =>
        input.inspect({
          record,
          sessionID: chat.id,
          workspace: directory,
          mcp: connected,
          messages,
          ...(estimate ? { estimate } : {}),
          ...(complete ? { complete } : {}),
          ...(evaluate ? { evaluate } : {}),
        }),
      )
    }).pipe(provideInstance(directory))
  })

  return body.pipe(
    Effect.scoped,
    Effect.provide(testInstanceStoreLayer),
    Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node)),
    Effect.provide(layerFor(hermetic)),
    Effect.runPromise,
  )
}

export * as EvalHarness from "./harness"
