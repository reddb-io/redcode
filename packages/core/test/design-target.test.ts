import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { viewports } from "@reddb-io/redcode-design/viewports"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { DesignStore } from "../src/design/store"
import { DesignTarget } from "../src/design/target"
import { DesignViewports } from "../src/design/viewports"
import { DesignPlaybooks } from "../src/design/playbooks"
import { Intelligence } from "../src/intelligence"
import { Location } from "../src/location"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionV2 } from "../src/session"
import { tempLocationLayer } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

describe("viewports", () => {
  const cases: Array<[string, Parameters<typeof viewports>, ReturnType<typeof viewports>]> = [
    [
      "web defaults to 390, 768 and 1440",
      ["web", undefined],
      [
        { width: 390, height: 900 },
        { width: 768, height: 900 },
        { width: 1440, height: 900 },
      ],
    ],
    ["a document without a target is web", [undefined, undefined], viewports("web", undefined)],
    [
      "web follows configured breakpoints, sorted and without repeats",
      ["web", undefined, { breakpoints: [1280, 360, 1280] }],
      [
        { width: 360, height: 900 },
        { width: 1280, height: 900 },
      ],
    ],
    [
      "empty breakpoints fall back to the defaults",
      ["web", undefined, { breakpoints: [] }],
      viewports("web", undefined),
    ],
    ["web ignores a platform", ["web", "ios"], viewports("web", undefined)],
    ["an iOS app is one iPhone", ["app", "ios"], [{ width: 393, height: 852, device: "ios" }]],
    ["an Android app is one Android phone", ["app", "android"], [{ width: 412, height: 915, device: "android" }]],
    [
      "an app without a platform is both phones",
      ["app", undefined],
      [
        { width: 393, height: 852, device: "ios" },
        { width: 412, height: 915, device: "android" },
      ],
    ],
    [
      "an app ignores web breakpoints",
      ["app", "ios", { breakpoints: [1000] }],
      [{ width: 393, height: 852, device: "ios" }],
    ],
    ["a presentation is one 16:9 slide", ["presentation", undefined], [{ width: 1920, height: 1080 }]],
  ]
  test.each(cases)("%s", (_name, input, expected) => {
    expect(viewports(...input)).toEqual(expected)
  })

  test("survives serialization into the review page", () => {
    const serialized = new Function(`return (${viewports.toString()})`)() as typeof viewports
    expect(serialized("app", undefined)).toEqual(viewports("app", undefined))
    expect(serialized("web", undefined, { breakpoints: [500] })).toEqual([{ width: 500, height: 900 }])
  })

  test("core reads the document's target with the configured breakpoints", () => {
    expect(DesignViewports.of({ target: "web" }, { breakpoints: [600] })).toEqual([{ width: 600, height: 900 }])
    expect(DesignViewports.of({}, undefined)).toEqual(viewports("web", undefined))
    expect(DesignViewports.of({ target: "app", platform: "android" }, { breakpoints: [600] })).toEqual([
      { width: 412, height: 915, device: "android" },
    ])
  })
})

describe("DesignTarget", () => {
  test("routes each target to its playbooks", () => {
    expect(DesignPlaybooks.forTarget(undefined)).toEqual(["screen", "flow", "quality"])
    expect(DesignPlaybooks.forTarget("app")).toEqual(["mobile-app", "quality"])
    expect(DesignPlaybooks.forTarget("presentation")).toEqual(["slides"])
    for (const target of ["web", "app", "presentation"] as const)
      for (const id of DesignPlaybooks.forTarget(target)) expect(DesignPlaybooks.find(id)).toBeDefined()
    expect(DesignTarget.describe({ target: "app", platform: "ios" })).toBe(
      "Target: iOS app · playbooks: mobile-app, quality",
    )
  })

  test("the confirmation puts the proposal first, marked recommended, and maps every answer back", () => {
    const asked = DesignTarget.question({ target: "app" }, "detail")
    expect(asked.header).toBe(DesignTarget.HEADER)
    expect(asked.custom).toBe(false)
    expect(asked.options.map((option) => option.label)).toEqual([
      "Mobile app (Recommended)",
      "Web",
      "iOS app",
      "Android app",
      "Presentation",
    ])
    expect(DesignTarget.answer("Mobile app (Recommended)")).toEqual({ target: "app" })
    expect(DesignTarget.answer("Android app")).toEqual({ target: "app", platform: "android" })
    expect(DesignTarget.answer("Presentation")).toEqual({ target: "presentation" })
    expect(DesignTarget.answer(undefined)).toBeUndefined()
    expect(DesignTarget.answer("Something else")).toBeUndefined()
  })

  test("dual reasoning classifies the request with System One and preselects the detection", async () => {
    await using dir = await tmpdir()
    const calls: Array<{ state: { sources: unknown }; questions: Record<string, unknown> }> = []
    const asked: Array<ReturnType<typeof DesignTarget.question>> = []
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* dual(dir.path, (body) => {
          calls.push(body)
          return Response.json({
            model: "jev-test",
            answers: {
              target: {
                type: "choice",
                choice: "app",
                probabilities: { web: 0.05, app: 0.9, presentation: 0.05 },
                confidence: 0.9,
              },
              platform: {
                type: "choice",
                choice: "ios",
                probabilities: { ios: 0.8, android: 0.05, either: 0.15 },
                confidence: 0.8,
              },
            },
            usage: { input_tokens: 20, output_tokens: 2 },
          })
        })
        return yield* DesignTarget.choose({
          requested: { target: "web" },
          forced: undefined,
          mode: Intelligence.mode(yield* service.read()),
          detect: classify(service, "Quero um app de corrida para iPhone"),
          ask: (request) =>
            Effect.sync(() => {
              asked.push(request)
              return request.options[0]?.label
            }),
        })
      }),
    )
    expect(calls).toHaveLength(1)
    expect(Object.keys(calls[0]!.questions).toSorted()).toEqual(["platform", "target"])
    expect(JSON.stringify(calls[0]!.state.sources)).toContain("app de corrida")
    expect(asked).toHaveLength(1)
    expect(asked[0]!.options[0]!.label).toBe("iOS app (Recommended)")
    expect(asked[0]!.question).toContain("System One suggests iOS app (90% confident)")
    expect(outcome).toMatchObject({ target: "app", platform: "ios", source: "detected" })
    expect(outcome.note).toContain("detected by System One and confirmed by the user")
  })

  test("the user can override the detection", async () => {
    await using dir = await tmpdir()
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* dual(dir.path, () =>
          Response.json({
            model: "jev-test",
            answers: {
              target: {
                type: "choice",
                choice: "web",
                probabilities: { web: 0.7, app: 0.2, presentation: 0.1 },
                confidence: 0.7,
              },
              platform: {
                type: "choice",
                choice: "either",
                probabilities: { ios: 0, android: 0, either: 1 },
                confidence: 1,
              },
            },
            usage: { input_tokens: 20, output_tokens: 2 },
          }),
        )
        return yield* DesignTarget.choose({
          requested: {},
          forced: undefined,
          mode: Intelligence.mode(yield* service.read()),
          detect: classify(service, "A landing page"),
          ask: () => Effect.succeed("Presentation"),
        })
      }),
    )
    expect(outcome).toMatchObject({ target: "presentation", source: "user" })
    expect(outcome.platform).toBeUndefined()
  })

  test("single reasoning makes no System One call and takes the agent's tool parameters", async () => {
    await using dir = await tmpdir()
    let calls = 0
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Intelligence.make(
          dir.path,
          credentials,
          fetcher(() => {
            calls++
            return Response.json({})
          }),
        )
        yield* service.save({ settings: { ...settings, reasoning: "single" } })
        return yield* DesignTarget.choose({
          requested: { target: "app", platform: "android" },
          forced: undefined,
          mode: Intelligence.mode(yield* service.read()),
          detect: classify(service, "An Android app"),
          ask: () => Effect.die("single reasoning asks nothing"),
        })
      }),
    )
    expect(calls).toBe(0)
    expect(outcome).toMatchObject({ target: "app", platform: "android", source: "agent" })
    expect(outcome.note).toContain("no S1 call")
  })

  test("a forced target skips detection and the question", async () => {
    const outcome = await Effect.runPromise(
      DesignTarget.choose({
        requested: { target: "web" },
        forced: { target: "presentation" },
        mode: "dual",
        detect: Effect.die("a forced target is not detected"),
        ask: () => Effect.die("a forced target is not confirmed"),
      }),
    )
    expect(outcome).toMatchObject({ target: "presentation", source: "flag" })
    expect(outcome.note).toContain("--target")
  })

  test("a System One failure preselects the agent's choice and says so", async () => {
    await using dir = await tmpdir()
    const asked: Array<ReturnType<typeof DesignTarget.question>> = []
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* dual(dir.path, () => Response.json({ error: "down" }, { status: 500 }))
        return yield* DesignTarget.choose({
          requested: { target: "presentation" },
          forced: undefined,
          mode: Intelligence.mode(yield* service.read()),
          detect: classify(service, "Slides for the quarterly review"),
          ask: (request) =>
            Effect.sync(() => {
              asked.push(request)
              return undefined
            }),
        })
      }),
    )
    expect(asked[0]!.options[0]!.label).toBe("Presentation (Recommended)")
    expect(asked[0]!.question).toContain("System One could not classify the request")
    expect(outcome).toMatchObject({ target: "presentation", source: "fallback" })
    expect(outcome.note).toContain("System One unavailable")
  })

  test("without an agent choice a failure falls back to web", async () => {
    const outcome = await Effect.runPromise(
      DesignTarget.choose({
        requested: {},
        forced: undefined,
        mode: "dual",
        detect: Effect.fail("unreachable"),
        ask: () => Effect.succeed(undefined),
      }),
    )
    expect(outcome).toMatchObject({ target: "web", source: "fallback" })
  })
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([DesignStore.node, Database.node, Location.node, Intelligence.node]), [
    [Location.node, tempLocationLayer],
  ]),
)

const session = Effect.gen(function* () {
  const database = yield* Database.Service
  const location = yield* Location.Service
  const sessionID = SessionV2.ID.make(`ses_${crypto.randomUUID()}`)
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: location.directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "design-target",
      directory: location.directory,
      title: "Design target",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return sessionID
})

describe("DesignStore targets", () => {
  it.effect("a new design is web unless it names a target, and the target survives a reload", () =>
    Effect.gen(function* () {
      const store = yield* DesignStore.Service
      const sessionID = yield* session
      const web = yield* store.create(sessionID, { name: "Site", journey: "new", engine: "html", kind: "screen" })
      expect(web.target).toBe("web")
      expect(web.platform).toBeUndefined()
      const app = yield* store.create(sessionID, {
        name: "Runner",
        journey: "new",
        engine: "html",
        kind: "flow",
        target: "app",
        platform: "ios",
      })
      expect(yield* store.get(app.id)).toMatchObject({ target: "app", platform: "ios" })
      expect(
        Object.fromEntries((yield* store.list(sessionID)).map((item) => [item.name, [item.target, item.platform]])),
      ).toEqual({ Site: ["web", undefined], Runner: ["app", "ios"] })
    }),
  )

  it.effect("the target changes through update, and leaving app drops the platform", () =>
    Effect.gen(function* () {
      const store = yield* DesignStore.Service
      const sessionID = yield* session
      const document = yield* store.create(sessionID, {
        name: "Runner",
        journey: "new",
        engine: "html",
        kind: "screen",
        target: "app",
        platform: "android",
      })
      expect(yield* store.update(document.id, { name: "Runner v2" })).toMatchObject({
        target: "app",
        platform: "android",
      })
      const deck = yield* store.update(document.id, { target: "presentation" })
      expect(deck.target).toBe("presentation")
      expect(deck.platform).toBeUndefined()
      expect((yield* store.get(document.id)).platform).toBeUndefined()
      const refused = yield* store.update(document.id, { platform: "ios" }).pipe(Effect.flip)
      expect(refused.message).toContain("Only an app design takes a platform")
      const created = yield* store
        .create(sessionID, { name: "Bad", journey: "new", engine: "html", kind: "screen", platform: "ios" })
        .pipe(Effect.flip)
      expect(created.code).toBe("invalid")
    }),
  )
})

const credentials = {
  get: () => Effect.succeed(undefined),
  list: () => Effect.succeed([]),
  create: () => Effect.die("Credential creation not expected"),
}

const settings = {
  enabled: true,
  reasoning: "dual" as const,
  onboarding: "completed" as const,
  principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
  evaluator: { transport: "typesafe" as const, baseURL: "https://api.typesafe.ai/v1", model: "jev-test" },
}

function fetcher(reply: (body: never) => Response): typeof fetch {
  return Object.assign(
    (_url: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(reply(JSON.parse(String(init?.body ?? "{}")) as never)),
    { preconnect() {} },
  )
}

function dual(root: string, reply: (body: never) => Response) {
  return Effect.gen(function* () {
    const service = yield* Intelligence.make(root, credentials, fetcher(reply))
    yield* service.save({ settings })
    return service
  })
}

function classify(service: Intelligence.Interface, request: string) {
  return service.evaluate(
    DesignTarget.evaluation({
      sessionID: "ses_design_target",
      requests: [request],
      design: { name: "Design", kind: "screen" },
    }),
  )
}
