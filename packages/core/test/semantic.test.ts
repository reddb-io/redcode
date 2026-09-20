import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Semantic } from "../src/semantic"
import { Intelligence } from "../src/intelligence"
import { SessionSchema } from "../src/session/schema"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { tmpdir } from "./fixture/tmpdir"

for (const scenario of ["accepted", "repaired", "uncertain", "unavailable", "disabled"] as const) {
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
              noul: scenario === "accepted" || (scenario === "repaired" && evaluated.length === 2) ? 0 : 0.5,
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
              onboarding: "completed",
              principal: { id: Model.ID.make("principal"), providerID: Provider.ID.make("fixture") },
              evaluator: { transport: "typesafe", model: "jev-1.13.0", baseURL: `${server.url}v1` },
            },
          })
          const transform = Semantic.transformer(intelligence, (_id, _prompt, strong = false) => {
            generated.push(strong)
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
              : scenario === "accepted" || scenario === "unavailable"
                ? [false]
                : [false, true],
          )
          expect(evaluated.length).toBe(generated.length)
          if (scenario === "uncertain" || scenario === "unavailable") expect(result._tag).toBe("Failure")
          else {
            expect(result._tag).toBe("Success")
            if (result._tag === "Success")
              expect(result.success).toEqual(
                scenario === "disabled" ? undefined : { action: scenario === "repaired" ? "repair" : "initial" },
              )
          }
        }),
      )
    } finally {
      server.stop(true)
    }
  })
}
