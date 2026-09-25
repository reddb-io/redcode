import { afterAll, describe, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Layer, Stream } from "effect"
import { LLMClient, LLMEvent, Model, type LLMClientShape } from "@reddb-io/redcode-llm"
import * as OpenAIChat from "@reddb-io/redcode-llm/protocols/openai-chat"
import { AgentV2 } from "@reddb-io/redcode-core/agent"
import { Config } from "@reddb-io/redcode-core/config"
import { Database } from "@reddb-io/redcode-core/database/database"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNodePlatform } from "@reddb-io/redcode-core/effect/app-node-platform"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { HookV2 } from "@reddb-io/redcode-core/hook"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { Location } from "@reddb-io/redcode-core/location"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { ModelLimit } from "@reddb-io/redcode-core/model-limit"
import { PermissionV2 } from "@reddb-io/redcode-core/permission"
import { ProjectV2 } from "@reddb-io/redcode-core/project"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
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
import { SessionStore } from "@reddb-io/redcode-core/session/store"
import { SkillGuidance } from "@reddb-io/redcode-core/skill/guidance"
import { Snapshot } from "@reddb-io/redcode-core/snapshot"
import { SystemContext } from "@reddb-io/redcode-core/system-context"
import { ToolRegistry } from "@reddb-io/redcode-core/tool/registry"
import { testEffect } from "./lib/effect"

// A project with a Tailwind theme and components, so identification has something to ask S1 about.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "redcode-design-warm-"))
for (const [file, content] of Object.entries({
  "package.json": JSON.stringify({ name: "web", dependencies: { react: "^19.0.0", tailwindcss: "^3.4.0" } }),
  "tailwind.config.ts": "export default {}\n",
  "src/styles/globals.css": "@tailwind base;\n:root {\n  --primary: #111;\n}\n",
  "src/components/Button.tsx": "export function Button() { return <button /> }\n",
})) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), content)
}
fs.mkdirSync(path.join(root, ".git"), { recursive: true })
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const text = (value: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "reply" }),
  LLMEvent.textDelta({ id: "reply", text: value }),
  LLMEvent.textEnd({ id: "reply" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]
let responses: LLMEvent[][] = []
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: (() => Stream.fromIterable(responses.shift() ?? [])) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })

// Dual reasoning that answers nothing: the runner goes on unrouted, and every question is recorded.
let operations: string[] = []
const intelligence = Layer.mock(Intelligence.Service, {
  environment: "test",
  read: () =>
    Effect.succeed({
      enabled: true,
      reasoning: "dual" as const,
      onboarding: "completed" as const,
      principal: { providerID: ProviderV2.ID.make("fake"), id: ModelV2.ID.make("fake-model") },
      evaluator: { transport: "typesafe" as const, baseURL: "https://system-one.test/v1", model: "jev-test" },
    }),
  evaluate: (input) =>
    Effect.sync(() => {
      operations.push(input.operation)
      return undefined
    }),
  history: () => Effect.succeed([]),
  generation: () => Effect.void,
  router: () => Effect.succeed(undefined),
})

// The real catalog, as in session-runner.test.ts: booting the Location's plugins transforms it.
const overrides: LayerNode.Replacements = [
  [LayerNodePlatform.llmClient, client],
  [ModelLimit.node, ModelLimit.memoryLayer()],
  [PermissionV2.node, Layer.mock(PermissionV2.Service, { assert: () => Effect.void, rules: () => Effect.succeed([]) })],
  [SessionRunnerModel.node, SessionRunnerModel.layerWith(() => Effect.succeed(model))],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make(root) })],
  [SkillGuidance.node, Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })],
  [ReferenceGuidance.node, Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })],
  [Snapshot.node, Snapshot.noopLayer],
  [Config.node, Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))],
  [Intelligence.node, intelligence],
  [HookV2.node, Layer.mock(HookV2.Service, { run: () => Effect.succeed({ continue: true }) })],
  [
    ProjectV2.node,
    Layer.mock(ProjectV2.Service, {
      resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
      directories: () => Effect.succeed([]),
      commit: () => Effect.void,
    }),
  ],
]
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const runner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => runner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
    })
  }),
).pipe(Layer.provide(AppNodeBuilder.build(SessionRunnerLLM.node, overrides)))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      AgentV2.node,
      ToolRegistry.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [...overrides, [SessionExecution.node, execution]],
  ),
)

/** Runs one turn of a Session on `agent`, then gives the background warm-up up to `wait` ms to ask S1. */
const turn = (agent: string, wait: number) =>
  Effect.gen(function* () {
    operations = []
    responses = [text("Here is a first sketch.")]
    const agents = yield* AgentV2.Service
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make(agent), (info) => {
        info.mode = "primary"
      }),
    )
    const sessions = yield* SessionV2.Service
    const session = yield* sessions.create({
      location: Location.Ref.make({ directory: AbsolutePath.make(root) }),
      agent: AgentV2.ID.make(agent),
      model: { id: ModelV2.ID.make("fake-model"), providerID: ProviderV2.ID.make("fake") },
    })
    yield* sessions.prompt({
      sessionID: session.id,
      prompt: Prompt.make({ text: "Sketch a pricing page" }),
      resume: false,
    })
    yield* sessions.resume(session.id)
    const deadline = Date.now() + wait
    while (!operations.includes("design_system_detect") && Date.now() < deadline) yield* Effect.sleep("20 millis")
    return operations
  })

describe("V2 design-system warm-up", () => {
  it.live("the design agent's turn starts identifying the design system in the background", () =>
    Effect.gen(function* () {
      expect(yield* turn("design", 5_000)).toContain("design_system_detect")
    }),
  )

  it.live("a turn neither the design agent runs nor S1 routes as design identifies nothing", () =>
    Effect.gen(function* () {
      expect(yield* turn("build", 500)).not.toContain("design_system_detect")
    }),
  )
})
