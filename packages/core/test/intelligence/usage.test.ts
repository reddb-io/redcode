import { describe, expect } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { Intelligence, type EvaluationInput } from "@opencode/core/intelligence"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionBudget } from "@opencode/core/session/budget"
import { SessionTable } from "@opencode/core/session/sql"
import { Integration } from "@opencode/schema/integration"
import { Model } from "@opencode/schema/model"
import { Project } from "@opencode/schema/project"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { tempGlobalLayer } from "../fixture/global"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Intelligence.node, Credential.node, Database.node, SessionBudget.node]), {
    replacements: [Global.node.replace(tempGlobalLayer)],
  }),
)

const serve = (fetch: (request: Request) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (server) => Effect.sync(() => server.stop(true)),
  )

const configure = (baseURL: string) =>
  Effect.gen(function* () {
    // The test preload disables S1 globally; enable only this isolated fixture's scope.
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const previous = process.env.REDCODE_REASONING
        process.env.REDCODE_REASONING = "dual"
        return previous
      }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) {
            delete process.env.REDCODE_REASONING
            return
          }
          process.env.REDCODE_REASONING = previous
        }),
    )
    const db = (yield* Database.Service).db
    const credentials = yield* Credential.Service
    const intelligence = yield* Intelligence.Service
    const projectID = Project.ID.make("s1-usage-project")
    const sessionID = Session.ID.make("ses_s1_usage")
    yield* db.insert(ProjectTable).values({ id: projectID, worktree: AbsolutePath.make("/s1-usage"), sandboxes: [] })
    yield* db.insert(SessionTable).values({
      id: sessionID,
      project_id: projectID,
      slug: "s1-usage",
      directory: "/s1-usage",
      version: "test",
    })
    const credential = yield* credentials.create({
      integrationID: Integration.ID.make("red-router"),
      label: "Router",
      value: Credential.Key.make({ type: "key", key: "test-key", configuration: { baseURL } }),
    })
    yield* intelligence.save({
      settings: {
        enabled: true,
        reasoning: "dual",
        onboarding: "completed",
        principal: { providerID: Provider.ID.make("red-router"), id: Model.ID.make("chat") },
        evaluator: { transport: "red-router", baseURL, model: "jev", credentialID: credential.id },
      },
    })
    return sessionID
  })

describe("System One usage accounting", () => {
  ;([0, 0.0042] as const).forEach((cost) => {
    it.live(`persists each reported USD charge of ${cost} without locally caching responses`, () =>
      Effect.gen(function* () {
        const requests: string[] = []
        const server = yield* serve((request) => {
          requests.push(new URL(request.url).pathname)
          return Response.json({
            model: "jev",
            answers: { check: { type: "noul", noul: 0 } },
            usage: { input_tokens: 100, output_tokens: 5, cost },
          })
        })
        const sessionID = yield* configure(`${server.url.href}v1`)
        const intelligence = yield* Intelligence.Service
        const budgets = yield* SessionBudget.Service
        const input: EvaluationInput = {
          sessionID,
          operation: "response_quality",
          sources: "source",
          questions: { check: { type: "noul", instructions: "Check for an error" } },
        }
        const evaluated = yield* intelligence.evaluate(input)
        expect(evaluated?.usage.cost).toBe(cost)
        expect(yield* intelligence.history(sessionID)).toEqual([evaluated!])
        const second = yield* intelligence.evaluate(input)
        expect(second?.id).not.toBe(evaluated?.id)
        expect(requests).toHaveLength(2)
        expect(yield* budgets.totals(sessionID)).toEqual({ cost: cost * 2, tokens: 210, unpriced: 0 })
        if (cost > 0) expect(yield* budgets.admit(sessionID, { maxCostUsd: cost })).toBe(false)
      }),
    )
  })
  ;(["gate", "classification"] as const).forEach((kind) => {
    it.live(`counts a decoded ${kind} response with missing answers without caching its verdict`, () =>
      Effect.gen(function* () {
        const requests: string[] = []
        const server = yield* serve((request) => {
          requests.push(new URL(request.url).pathname)
          expect(request.headers.get("authorization")).toBe("Bearer test-key")
          return Response.json({
            model: "jev",
            answers: requests.length === 1 ? {} : { check: { type: "noul", noul: 0 } },
            usage: { input_tokens: 100, output_tokens: 5 },
          })
        })
        const sessionID = yield* configure(`${server.url.href}v1`)
        const intelligence = yield* Intelligence.Service
        const budgets = yield* SessionBudget.Service
        const input: EvaluationInput = {
          sessionID,
          operation: kind === "classification" ? "prompt_classification" : "response_quality",
          kind,
          sources: "source",
          questions: { check: { type: "noul", instructions: "Check for an error" } },
        }
        const failed = yield* intelligence.evaluate(input)
        expect(failed).toMatchObject({
          decision: "unavailable",
          answers: {},
          usage: { input_tokens: 100, output_tokens: 5 },
        })
        expect(yield* intelligence.history(sessionID)).toEqual([failed!])
        expect(yield* budgets.totals(sessionID)).toEqual({ cost: 0, tokens: 105, unpriced: 1 })
        expect(yield* budgets.admit(sessionID, { maxTokens: 100 })).toBe(false)

        const retried = yield* intelligence.evaluate(input)
        expect(retried?.decision).toBe("accepted")
        expect(retried?.id).not.toBe(failed?.id)
        expect(retried?.usage).toEqual({ input_tokens: 100, output_tokens: 5 })
        expect(requests).toEqual(["/v1/systemone", "/v1/systemone"])
        expect(yield* budgets.totals(sessionID)).toEqual({ cost: 0, tokens: 210, unpriced: 2 })
      }),
    )
  })

  it.live("retains completed chunk usage if a later compaction batch fails and counts a fresh retry separately", () =>
    Effect.gen(function* () {
      const fixture = { fail: true }
      const requests: string[] = []
      const server = yield* serve((request) => {
        requests.push(new URL(request.url).pathname)
        if (fixture.fail && requests.length > 2) return new Response("Unavailable", { status: 500 })
        return Response.json({
          model: "jev",
          answers: { check: { type: "noul", noul: 0 } },
          usage: { input_tokens: 100, output_tokens: 5 },
        })
      })
      const sessionID = yield* configure(`${server.url.href}v1`)
      const intelligence = yield* Intelligence.Service
      const budgets = yield* SessionBudget.Service
      const input: EvaluationInput = {
        sessionID,
        operation: "compaction",
        sources: ["x".repeat(90_000)],
        questions: { check: { type: "noul", instructions: "Check for lost information" } },
      }
      const failed = yield* intelligence.evaluate(input)
      expect(failed?.decision).toBe("unavailable")
      expect(failed?.answers).toEqual({})
      // Dispatching a third request requires at least one of the first two to finish.
      expect(requests.length).toBeGreaterThanOrEqual(3)
      expect(failed!.usage.input_tokens).toBeGreaterThanOrEqual(100)
      expect(failed!.usage.input_tokens).toBeLessThanOrEqual(200)
      expect(failed!.usage.input_tokens % 100).toBe(0)
      expect(failed!.usage.output_tokens).toBe(failed!.usage.input_tokens / 20)
      expect(yield* intelligence.history(sessionID)).toEqual([failed!])
      const spent = yield* budgets.totals(sessionID)
      expect(spent).toEqual({
        cost: 0,
        tokens: failed!.usage.input_tokens + failed!.usage.output_tokens,
        unpriced: 1,
      })

      fixture.fail = false
      const retried = yield* intelligence.evaluate(input)
      expect(retried?.decision).toBe("accepted")
      expect(retried?.id).not.toBe(failed?.id)
      expect(Object.keys(retried!.answers)).toHaveLength(8)
      expect(retried?.usage).toEqual({ input_tokens: 800, output_tokens: 40 })
      expect(yield* budgets.totals(sessionID)).toEqual({ cost: 0, tokens: spent.tokens + 840, unpriced: 2 })
    }),
  )

  it.live("does not trust reported usage in a response rejected by the schema", () =>
    Effect.gen(function* () {
      const server = yield* serve(() =>
        Response.json({
          model: "jev",
          answers: { check: { type: "noul", noul: 2 } },
          usage: { input_tokens: 100, output_tokens: 5 },
        }),
      )
      const sessionID = yield* configure(`${server.url.href}v1`)
      const intelligence = yield* Intelligence.Service
      const budgets = yield* SessionBudget.Service
      const failed = yield* intelligence.evaluate({
        sessionID,
        operation: "response_quality",
        sources: "source",
        questions: { check: { type: "noul", instructions: "Check for an error" } },
      })
      expect(failed).toMatchObject({
        decision: "unavailable",
        answers: {},
        usage: { input_tokens: 0, output_tokens: 0 },
      })
      expect(yield* intelligence.history(sessionID)).toEqual([failed!])
      expect(yield* budgets.totals(sessionID)).toEqual({ cost: 0, tokens: 0, unpriced: 1 })
    }),
  )
  it.live(
    "observes asynchronously, exposes pending work and records cost without returning an actionable verdict",
    () =>
      Effect.gen(function* () {
        const gate = Promise.withResolvers<void>()
        const started = Promise.withResolvers<void>()
        const server = yield* serve(async () => {
          started.resolve()
          await gate.promise
          return Response.json({
            model: "jev",
            answers: { check: { type: "noul", noul: 0.99 } },
            usage: { input_tokens: 20, output_tokens: 2, cost: 0.003 },
          })
        })
        const sessionID = yield* configure(`${server.url.href}v1`)
        const intelligence = yield* Intelligence.Service
        // A session-local override wins over the fixture's global dual flag.
        const db = (yield* Database.Service).db
        yield* db
          .update(SessionTable)
          .set({ metadata: { reasoning: "observe" } })
          .where(eq(SessionTable.id, sessionID))
        const verdict = yield* intelligence.evaluate({
          sessionID,
          operation: "response_quality",
          sources: "candidate evidence",
          questions: { check: { type: "noul", instructions: "Check for a concrete error" } },
        })
        expect(verdict).toBeUndefined()
        yield* Effect.promise(() => started.promise)
        expect((yield* intelligence.status(sessionID)).observations?.pending).toBe(1)
        expect(yield* intelligence.history(sessionID)).toEqual([])
        gate.resolve()
        const wait = Effect.gen(function* () {
          while (!(yield* intelligence.history(sessionID)).length) yield* Effect.sleep("10 millis")
        })
        yield* wait.pipe(Effect.timeout("5 seconds"))
        expect((yield* intelligence.history(sessionID))[0]).toMatchObject({
          mode: "observe",
          decision: "needs_revision",
          usage: { cost: 0.003 },
        })
        const budgets = yield* SessionBudget.Service
        expect(yield* budgets.totals(sessionID)).toEqual({ cost: 0.003, tokens: 22, unpriced: 0 })
      }),
  )
})
