import { afterAll, describe, expect } from "bun:test"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@reddb-io/redcode-llm"
import * as OpenAIChat from "@reddb-io/redcode-llm/protocols/openai-chat"
import { ChildProcess } from "effect/unstable/process"
import { AgentV2 } from "@reddb-io/redcode-core/agent"
import { Config } from "@reddb-io/redcode-core/config"
import { Database } from "@reddb-io/redcode-core/database/database"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNodePlatform } from "@reddb-io/redcode-core/effect/app-node-platform"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { Location } from "@reddb-io/redcode-core/location"
import { LocationMutation } from "@reddb-io/redcode-core/location-mutation"
import { PermissionV2 } from "@reddb-io/redcode-core/permission"
import { AppProcess } from "@reddb-io/redcode-core/process"
import { Project } from "@reddb-io/redcode-core/project"
import { ProjectTable } from "@reddb-io/redcode-core/project/sql"
import { QuestionV2 } from "@reddb-io/redcode-core/question"
import { ReferenceGuidance } from "@reddb-io/redcode-core/reference/guidance"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { SessionV2 } from "@reddb-io/redcode-core/session"
import { SessionExecution } from "@reddb-io/redcode-core/session/execution"
import { Prompt } from "@reddb-io/redcode-core/session/prompt"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { SessionRunCoordinator } from "@reddb-io/redcode-core/session/run-coordinator"
import { SessionRunner } from "@reddb-io/redcode-core/session/runner"
import * as SessionRunnerLLM from "@reddb-io/redcode-core/session/runner/llm"
import { SessionRunnerModel } from "@reddb-io/redcode-core/session/runner/model"
import { SessionTable } from "@reddb-io/redcode-core/session/sql"
import { SessionStore } from "@reddb-io/redcode-core/session/store"
import { SessionTaskFacts } from "@reddb-io/redcode-core/session/task-facts"
import { SessionTodo } from "@reddb-io/redcode-core/session/todo"
import { SkillGuidance } from "@reddb-io/redcode-core/skill/guidance"
import { Snapshot } from "@reddb-io/redcode-core/snapshot"
import { SystemContext } from "@reddb-io/redcode-core/system-context"
import { SystemContextRegistry } from "@reddb-io/redcode-core/system-context/registry"
import { ApplicationTools } from "@reddb-io/redcode-core/tool/application-tools"
import { BashTool } from "@reddb-io/redcode-core/tool/bash"
import { ToolRegistry } from "@reddb-io/redcode-core/tool/registry"
import { ShellPolling } from "@reddb-io/redcode-core/tool/shell-polling"
import { Effect, Layer, Stream } from "effect"
import { SessionGoal } from "../src/session/goal"
import { SessionPlan } from "../src/session/plan"
import { testEffect } from "./lib/effect"

const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "redcode-bash-polling-")))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

const requests: LLMRequest[] = []
let responses: LLMEvent[][] = []
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(responses.shift() ?? [])
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))

const asked: string[] = []
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => void asked.push(...input.resources)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const ran: string[] = []
const appProcess = Layer.succeed(
  AppProcess.Service,
  AppProcess.Service.of({
    run: (command: ChildProcess.Command) =>
      Effect.sync(() => {
        if (command._tag === "StandardCommand") ran.push(command.command)
        const output = Buffer.from('{"status":"in_progress","conclusion":""}\n')
        return {
          command: "mock",
          exitCode: 0,
          output,
          stdout: output,
          stderr: Buffer.alloc(0),
          outputTruncated: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        }
      }),
  } as unknown as AppProcess.Interface),
)
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((registry) =>
      registry.register({ key: SystemContext.Key.make("test/empty"), load: Effect.succeed(SystemContext.empty) }),
    ),
  ),
).pipe(Layer.provideMerge(AppNodeBuilder.build(SystemContextRegistry.node)))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const location = Location.boundNode({ directory: AbsolutePath.make(directory) })

const overrides = [
  [LayerNodePlatform.llmClient, client],
  [PermissionV2.node, permission],
  [AppProcess.node, appProcess],
  [SessionRunnerModel.node, models],
  [SystemContextRegistry.node, systemContext],
  [Location.node, location],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [Snapshot.node, Snapshot.noopLayer],
  [Config.node, config],
] as const

const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [...overrides])
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
    })
  }),
).pipe(Layer.provide(runnerLayer))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      QuestionV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionTodo.node,
      SessionTaskFacts.node,
      SessionGoal.node,
      SessionPlan.node,
      ApplicationTools.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      LocationMutation.node,
      BashTool.node,
      SessionRunnerModel.node,
      SystemContextRegistry.node,
      SkillGuidance.node,
      ReferenceGuidance.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [...overrides, [SessionExecution.node, execution]],
  ),
)

const sessionID = SessionV2.ID.make("ses_bash_polling")
const step = (events: LLMEvent[], reason: "tool-calls" | "stop") => [
  LLMEvent.stepStart({ index: 0 }),
  ...events,
  LLMEvent.stepFinish({ index: 0, reason }),
  LLMEvent.finish({ reason }),
]
const bash = (id: string, input: { command: string; workdir?: string }) =>
  step([LLMEvent.toolCall({ id, name: "bash", input })], "tool-calls")

const toolResults = (request: LLMRequest | undefined) =>
  JSON.stringify(request?.messages.filter((message) => message.role === "tool") ?? [])

describe("SessionRunnerLLM bash polling guard", () => {
  it.effect("refuses a sleep polling loop, then runs the check-once retry the refusal names", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: sessionID,
          directory,
          title: "test",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "wait for run 123" }), resume: false })

      const polling = `for i in 1..12; do sleep 300; gh run view 123 --json status -q .status | grep -q completed && break; done`
      const refusal = ShellPolling.boundedRefusal(ShellPolling.detect(polling)!)
      // The model sends back the first call the refusal names: the check, once.
      const retry = JSON.parse(refusal.split("\n").find((line) => line.startsWith("{"))!)
      expect(retry).toEqual({ command: "gh run view 123 --json status,conclusion" })

      requests.length = 0
      responses = [
        bash("call-poll", { command: polling }),
        bash("call-check", retry),
        step(
          [
            LLMEvent.textStart({ id: "text-final" }),
            LLMEvent.textDelta({ id: "text-final", text: "Run 123 is still in progress. Check again later?" }),
            LLMEvent.textEnd({ id: "text-final" }),
          ],
          "stop",
        ),
      ]
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(3)
      expect(toolResults(requests[1])).toContain("Long waits are not supported in this mode")
      expect(toolResults(requests[1])).not.toContain("in_progress")
      expect(toolResults(requests[2])).toContain("in_progress")
      expect(ran).toEqual(["gh run view 123 --json status,conclusion"])
      expect(asked).toEqual(["gh run view 123 --json status,conclusion"])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user" },
        { type: "assistant", content: [{ type: "tool", name: "bash", state: { status: "error" } }] },
        { type: "assistant", content: [{ type: "tool", name: "bash", state: { status: "completed" } }] },
        { type: "assistant", finish: "stop" },
      ])
    }),
  )
})
