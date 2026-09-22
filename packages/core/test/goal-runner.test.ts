import { expect } from "bun:test"
import path from "node:path"
import { createHash } from "node:crypto"
import { Effect, Layer, Schema, Stream } from "effect"
import { LLMClient, LLMEvent, Model, type LLMRequest } from "@reddb-io/redcode-llm"
import { OpenAIChat } from "@reddb-io/redcode-llm/protocols/openai-chat"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { llmClient } from "../src/effect/app-node-platform"
import { Database } from "../src/database/database"
import { Location } from "../src/location"
import { PermissionV2 } from "../src/permission"
import { EventV2 } from "../src/event"
import { Snapshot } from "../src/snapshot"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionSchema } from "../src/session/schema"
import { SessionMessage } from "../src/session/message"
import { SessionInput } from "../src/session/input"
import { Prompt } from "../src/session/prompt"
import { SessionGoal } from "../src/session/goal"
import { SessionProjector } from "../src/session/projector"
import { SessionRunner } from "../src/session/runner"
import { node } from "../src/session/runner/llm"
import { SessionRunnerModel } from "../src/session/runner/model"
import { GoalTools } from "../src/tool/goal"
import { ToolRegistry } from "../src/tool/registry"
import { Tool } from "../src/tool/tool"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { Intelligence } from "../src/intelligence"
import { ModelV2 } from "../src/model"
import { Provider } from "@reddb-io/redcode-schema/provider"

let response: LLMEvent[] = []
const reviews: Intelligence.EvaluationInput[] = []
const requests: LLMRequest[] = []
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      node,
      GoalTools.node,
      SessionProjector.node,
      SessionRunnerModel.node,
      Database.node,
      EventV2.node,
      Location.node,
      SessionGoal.node,
      ToolRegistry.node,
    ]),
    [
      [Location.node, tempLocationLayer],
      [Snapshot.node, Snapshot.noopLayer],
      [
        Intelligence.node,
        Layer.mock(Intelligence.Service, {
          environment: "fixture",
          read: () =>
            Effect.succeed({
              enabled: true,
              reasoning: "dual",
              onboarding: "completed",
              principal: { providerID: Provider.ID.make("fixture"), id: ModelV2.ID.make("fixture") },
              evaluator: { transport: "typesafe", baseURL: "http://localhost/v1", model: "jev" },
            }),
          history: () => Effect.succeed([]),
          evaluate: (input) =>
            Effect.sync(() => {
              if (input.operation !== "goal_completion") return undefined
              reviews.push(input)
              return {
                id: crypto.randomUUID(),
                fingerprint: "fixture",
                sessionID: input.sessionID,
                operation: input.operation,
                policy: "fixture",
                decision: "accepted" as const,
                model: "jev",
                answers: {},
                issues: [],
                created: Date.now(),
                duration: 1,
                usage: { input_tokens: 10, output_tokens: 5 },
              }
            }),
        }),
      ],
      [
        PermissionV2.node,
        Layer.succeed(
          PermissionV2.Service,
          PermissionV2.Service.of({
            assert: () => Effect.void,
            ask: () => Effect.die("unused"),
            reply: () => Effect.die("unused"),
            get: () => Effect.die("unused"),
            forSession: () => Effect.die("unused"),
            list: () => Effect.die("unused"),
            rules: () => Effect.die("unused"),
          }),
        ),
      ],
      [
        SessionRunnerModel.node,
        SessionRunnerModel.layerWith(() =>
          Effect.succeed(
            Model.make({
              id: "fixture",
              provider: "fixture",
              route: OpenAIChat.route,
            }),
          ),
        ),
      ],
      [
        llmClient,
        Layer.succeed(
          LLMClient.Service,
          LLMClient.Service.of({
            prepare: () => Effect.die("unused"),
            stream: (request) => {
              requests.push(request)
              return Stream.fromIterable(response)
            },
            generate: () => Effect.die("Goal review must use typed System One evaluation"),
          }),
        ),
      ],
    ],
  ),
)

for (const order of ["before", "after"] as const) {
  it.live(
    `completion called ${order} a sibling write verifies the final artifact`,
    () =>
      Effect.gen(function* () {
        requests.length = 0
        reviews.length = 0
        const database = yield* Database.Service
        const location = yield* Location.Service
        const events = yield* EventV2.Service
        const goals = yield* SessionGoal.Service
        const registry = yield* ToolRegistry.Service
        const runner = yield* SessionRunner.Service
        const sessionID = SessionSchema.ID.make(`ses_${crypto.randomUUID()}`)
        yield* database.db
          .insert(ProjectTable)
          .values({
            id: Project.ID.global,
            worktree: location.directory,
            sandboxes: [],
          })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        yield* database.db
          .insert(SessionTable)
          .values({
            id: sessionID,
            project_id: Project.ID.global,
            directory: location.directory,
            title: "Concurrent completion",
            slug: "concurrent-completion",
            version: "test",
          })
          .run()
          .pipe(Effect.orDie)
        const file = path.join(location.directory, "evidence.md")
        yield* Effect.promise(() => Bun.write(file, "Original artifact"))
        yield* registry.register({
          late_write: Tool.make({
            description: "Finish an edit",
            input: Schema.Struct({}),
            output: Schema.String,
            execute: () =>
              Effect.gen(function* () {
                // Reproduce the old ordering, but also allow a correct completion barrier to progress.
                yield* Effect.gen(function* () {
                  while ((yield* goals.get(sessionID).pipe(Effect.orDie))?.status !== "done")
                    yield* Effect.sleep("1 millis")
                }).pipe(Effect.timeoutOption("500 millis"))
                yield* Effect.promise(() => Bun.write(file, "Final artifact after the sibling edit"))
                return "Edit finished"
              }),
          }),
        })
        yield* goals.start(sessionID, { objective: "Verify the final artifact", maxTurns: 1 })
        yield* SessionInput.admit(database.db, events, {
          id: SessionMessage.ID.create(),
          sessionID,
          prompt: Prompt.make({ text: "Finish and verify" }),
          delivery: "steer",
        })
        const complete = LLMEvent.toolCall({
          id: "complete",
          name: "goal_complete",
          input: { evidence: [file], explanation: "Ready" },
        })
        const write = LLMEvent.toolCall({ id: "write", name: "late_write", input: {} })
        response = [
          LLMEvent.stepStart({ index: 0 }),
          ...(order === "before" ? [complete, write] : [write, complete]),
          LLMEvent.stepFinish({
            index: 0,
            reason: "tool-calls",
            usage: { inputTokens: 10, nonCachedInputTokens: 10, outputTokens: 5, totalTokens: 15 },
          }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ]
        yield* runner.run({ sessionID, force: true })
        const goal = yield* goals.get(sessionID)
        const content = yield* Effect.promise(() => Bun.file(file).text())
        expect(goal?.status).toBe("done")
        expect(goal?.tokens).toBe(30)
        expect(goal?.reviews).toBe(1)
        expect(goal?.evidence[0]?.hash).toBe(createHash("sha256").update(content).digest("hex"))
        expect(reviews).toHaveLength(1)
        expect(JSON.stringify(reviews[0].sources)).toContain("Final artifact after the sibling edit")
        expect(requests).toHaveLength(1)
      }),
    30000,
  )
}
