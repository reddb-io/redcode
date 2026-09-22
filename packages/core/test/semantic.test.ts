import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Semantic } from "../src/semantic"
import { Intelligence } from "../src/intelligence"
import { SessionSchema } from "../src/session/schema"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { tmpdir } from "./fixture/tmpdir"

for (const scenario of [
  "accepted",
  "repaired",
  "invalid-json",
  "provider-failure",
  "uncertain",
  "unavailable",
  "disabled",
  "single",
] as const) {
  test(`transformation ${scenario} obeys bounded repair and fail-closed decisions`, async () => {
    await using dir = await tmpdir()
    const generated: boolean[] = []
    const evaluated: unknown[] = []
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        evaluated.push(await request.json())
        if (scenario === "unavailable") return new Response("offline", { status: 503 })
        return Response.json({
          model: "jev-1.13.0",
          answers: {
            error: {
              type: "noul",
              noul:
                scenario === "accepted" ||
                scenario === "invalid-json" ||
                (scenario === "repaired" && evaluated.length === 2)
                  ? 0
                  : 0.5,
            },
          },
          usage: { input_tokens: 10, output_tokens: 1 },
        })
      },
    })
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const intelligence = yield* Intelligence.make(dir.path, {
            get: () => Effect.succeed(undefined),
            list: () => Effect.succeed([]),
            create: () => Effect.die("unused"),
          })
          yield* intelligence.save({
            settings: {
              enabled: scenario !== "disabled",
              reasoning: scenario === "single" ? "single" : "dual",
              onboarding: "completed",
              principal: { id: Model.ID.make("principal"), providerID: Provider.ID.make("fixture") },
              evaluator: { transport: "typesafe", model: "jev-1.13.0", baseURL: `${server.url}v1` },
            },
          })
          const transform = Semantic.transformer(intelligence, (_id, _prompt, strong = false) => {
            generated.push(strong)
            if (scenario === "provider-failure")
              return Effect.fail(new Intelligence.Error({ message: "Provider unavailable" }))
            if (scenario === "invalid-json" && !strong) return Effect.succeed("invalid JSON")
            return Effect.succeed(JSON.stringify({ action: strong ? "repair" : "initial" }))
          })
          const result = yield* transform({
            sessionID: SessionSchema.ID.make("ses_semantic"),
            operation: "todos",
            sources: "Preserve filters",
            prompt: "Produce an action",
            decode: Semantic.json(Schema.Struct({ action: Schema.String })),
            checks: () => Intelligence.questions({ error: "Does candidate omit requirements?" }),
          }).pipe(Effect.result)
          expect(generated).toEqual(
            scenario === "disabled"
              ? []
              : scenario === "accepted" ||
                  scenario === "unavailable" ||
                  scenario === "provider-failure" ||
                  scenario === "single"
                ? [false]
                : [false, true],
          )
          expect(evaluated.length).toBe(
            scenario === "provider-failure" || scenario === "single"
              ? 0
              : scenario === "invalid-json"
                ? 1
                : generated.length,
          )
          if (
            scenario === "uncertain" ||
            scenario === "unavailable" ||
            scenario === "disabled" ||
            scenario === "provider-failure"
          )
            expect(result._tag).toBe("Failure")
          else {
            expect(result._tag).toBe("Success")
            if (result._tag === "Success")
              expect(result.success).toEqual({
                action: scenario === "repaired" || scenario === "invalid-json" ? "repair" : "initial",
              })
          }
        }),
      )
    } finally {
      server.stop(true)
    }
  })
}

test("disabling S1 while evaluation is in flight cannot publish an accepted transformation", async () => {
  await using dir = await tmpdir()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const intelligence = yield* Intelligence.make(dir.path, {
          get: () => Effect.succeed(undefined),
          list: () => Effect.succeed([]),
          create: () => Effect.die("unused"),
        })
        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              fetch: async () => {
                const settings = await Effect.runPromise(intelligence.read())
                await Effect.runPromise(intelligence.save({ settings: { ...settings, enabled: false } }))
                return Response.json({
                  model: "jev",
                  answers: { error: { type: "noul", noul: 0.01 } },
                  usage: { input_tokens: 10, output_tokens: 0 },
                })
              },
            }),
          ),
          (server) => Effect.sync(() => server.stop(true)),
        )
        yield* intelligence.save({
          settings: {
            enabled: true,
            reasoning: "dual",
            onboarding: "completed",
            principal: { id: Model.ID.make("principal"), providerID: Provider.ID.make("fixture") },
            evaluator: { transport: "typesafe", model: "jev", baseURL: `${server.url}v1` },
          },
        })
        const generated: string[] = []
        const transform = Semantic.transformer(intelligence, () =>
          Effect.sync(() => {
            generated.push("candidate")
            return "candidate"
          }),
        )
        const result = yield* transform({
          sessionID: SessionSchema.ID.make("ses_semantic_disabled_inflight"),
          operation: "compaction",
          sources: "Original history",
          prompt: "Summarize",
          decode: Effect.succeed,
          checks: () => Intelligence.questions({ error: "Does candidate omit requirements?" }),
        }).pipe(Effect.result)
        expect(result._tag).toBe("Failure")
        expect(generated).toEqual(["candidate"])
        expect(
          (yield* intelligence.history(SessionSchema.ID.make("ses_semantic_disabled_inflight")))[0]?.decision,
        ).toBe("accepted")
      }),
    ),
  )
})
