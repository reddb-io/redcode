import { expect } from "bun:test"
import { Effect, Fiber } from "effect"
import path from "node:path"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Database } from "@reddb-io/redcode-core/database/database"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { SessionInput } from "@reddb-io/redcode-core/session/input"
import { SessionMessage } from "@reddb-io/redcode-core/session/message"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { Prompt } from "@reddb-io/redcode-core/session/prompt"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { EventV2Bridge } from "@/event-v2-bridge"
import { GoalRuntime } from "@/session/goal-runtime"
import { SessionGoal } from "@/session/goal"
import { Session } from "@/session/session"
import { MessageID, PartID } from "@/session/schema"
import { testEffect, awaitWithTimeout } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { testProviderConfig } from "../lib/test-provider"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      GoalRuntime.node,
      Session.node,
      SessionProjector.node,
      EventV2Bridge.node,
      Intelligence.node,
      Database.node,
      EventV2.node,
    ]),
  ),
)

const setup = Effect.gen(function* () {
  const intelligence = yield* Intelligence.Service
  const previous = yield* intelligence.read()
  const instance = yield* TestInstance
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        port: 0,
        fetch: async (request) => {
          if (new URL(request.url).pathname === "/v1/chat/completions") {
            const text = JSON.stringify({ verdict: "done", reason: "the saved artifact was verified" })
            return new Response(
              [
                {
                  id: "goal-judge",
                  object: "chat.completion.chunk",
                  created: 1,
                  model: "principal",
                  choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
                },
                {
                  id: "goal-judge",
                  object: "chat.completion.chunk",
                  created: 1,
                  model: "principal",
                  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                  usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
                },
              ]
                .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
                .join("") + "data: [DONE]\n\n",
              { headers: { "content-type": "text/event-stream" } },
            )
          }
          const body = await request.json()
          entered.resolve()
          await release.promise
          return Response.json({
            model: "jev",
            answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "noul", noul: 0.01 }])),
            usage: { input_tokens: 10, output_tokens: 0 },
          })
        },
      }),
    ),
    (server) =>
      intelligence.save({ settings: previous }).pipe(
        Effect.orDie,
        Effect.ensuring(
          Effect.sync(() => {
            release.resolve()
            server.stop(true)
          }),
        ),
      ),
  )
  yield* intelligence.save({
    settings: {
      enabled: true,
      onboarding: "completed",
      principal: { providerID: Provider.ID.make("test"), id: Model.ID.make("test-model") },
      evaluator: { transport: "typesafe", model: "jev", baseURL: `${server.url}v1` },
    },
  })
  yield* Effect.promise(() =>
    Bun.write(path.join(instance.directory, "redcode.json"), JSON.stringify(testProviderConfig(`${server.url}v1`))),
  )
  const sessions = yield* Session.Service
  const goals = yield* GoalRuntime.Service
  const chat = yield* sessions.create({ title: "Goal review concurrency" })
  yield* goals.set(chat.id, SessionGoal.parse("Verify the saved artifact"))
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID: chat.id,
    role: "user",
    agent: "build",
    model: { providerID: Provider.ID.make("test"), modelID: Model.ID.make("test-model") },
    time: { created: Date.now() },
  })
  const assistant = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID: chat.id,
    role: "assistant",
    agent: "build",
    mode: "build",
    parentID: user.id,
    providerID: Provider.ID.make("test"),
    modelID: Model.ID.make("test-model"),
    path: { cwd: instance.directory, root: instance.directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now(), completed: Date.now() },
    finish: "end_turn",
  })
  const proof = yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID: chat.id,
    type: "tool",
    tool: "read",
    callID: "read-artifact",
    state: {
      status: "completed",
      input: { filePath: "artifact.txt" },
      output: "Verified saved artifact contents",
      title: "Read artifact",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
    },
  })
  yield* goals.claim(chat.id, "The recorded read confirms the artifact contents")
  return {
    chat,
    goals,
    waiting: awaitWithTimeout(
      Effect.promise(() => entered.promise),
      "System One was not called",
      "5 seconds",
    ),
    release: Effect.sync(() => release.resolve()),
    review: goals.afterTurn({
      session: yield* sessions.get(chat.id),
      lastUser: user,
      lastAssistant: { info: assistant, parts: [proof] },
    }),
  }
})

for (const delivery of ["steer", "queue"] as const) {
  it.instance(`${delivery} admitted during System One review preserves the goal delivery contract`, () =>
    Effect.gen(function* () {
      const test = yield* setup
      const database = yield* Database.Service
      const events = yield* EventV2.Service
      const review = yield* test.review.pipe(Effect.forkChild)
      yield* test.waiting
      yield* SessionInput.admit(database.db, events, {
        id: SessionMessage.ID.create(),
        sessionID: test.chat.id,
        prompt: Prompt.make({ text: "Also verify rollback behavior" }),
        delivery,
      })
      yield* test.release
      const outcome = yield* Fiber.join(review)
      expect(outcome?.action).toBe(delivery === "steer" ? "continue" : "done")
      expect((yield* test.goals.get(test.chat.id))?.status).toBe(delivery === "steer" ? "active" : "done")
      expect(yield* SessionInput.hasPending(database.db, test.chat.id, delivery)).toBe(true)
    }),
  )
}

it.instance("a pause during System One review cannot be overwritten by completion", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const review = yield* test.review.pipe(Effect.forkChild)
    yield* test.waiting
    yield* test.goals.pause(test.chat.id, "User requested a pause")
    yield* test.release
    expect(yield* Fiber.join(review)).toBeUndefined()
    expect((yield* test.goals.get(test.chat.id))?.status).toBe("paused")
  }),
)

it.instance("a changed goal contract cannot reuse the previous completion verdict", () =>
  Effect.gen(function* () {
    const test = yield* setup
    const review = yield* test.review.pipe(Effect.forkChild)
    yield* test.waiting
    const current = yield* test.goals.get(test.chat.id)
    if (!current) throw new Error("Expected active goal")
    yield* test.goals.set(test.chat.id, { ...current, contract: { verification: "Also verify rollback" } })
    yield* test.release
    expect((yield* Fiber.join(review))?.action).toBe("continue")
    expect((yield* test.goals.get(test.chat.id))?.status).toBe("active")
  }),
)
