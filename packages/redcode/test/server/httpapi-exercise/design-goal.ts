import path from "node:path"
import { Effect, Schema, Schedule } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"
import { SessionGoal } from "@reddb-io/redcode-schema/session-goal"
import { SessionPlan } from "@reddb-io/redcode-schema/session-plan"
import { check, object } from "./assertions"
import { request } from "./backend"
import { http } from "./dsl"
import type { Method, Scenario, ScenarioContext } from "./types"

const root = "/api/session/{sessionID}/design"
const item = `${root}/{designID}`
const objective = "Prepare a concrete checkout plan"
const html = "<!doctype html><html><body><h1>HTTP API checkout</h1></body></html>"
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/></svg>'
const input = { name: "Checkout", journey: "new", engine: "html", kind: "screen" } as const
const media = {
  name: "checkout.svg",
  mime: "image/svg+xml",
  data: Buffer.from(svg).toString("base64"),
  source: "upload",
}

export const designGoalScenarios: Scenario[] = [
  http.protected
    .get(root, "v2.design.list")
    .seeded(document)
    .at((ctx) => ({ path: ctx.state.root, headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      const documents = Schema.decodeUnknownSync(Schema.Array(Design.Info))(body)
      check(documents.length === 1 && documents[0].id === ctx.state.document.id, "list should contain the owned design")
    }),
  http.protected
    .post(root, "v2.design.create")
    .seeded(session)
    .at((ctx) => ({ path: ctx.state.root, headers: ctx.headers(), body: input }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        const created = Schema.decodeUnknownSync(Design.Info)(body)
        check(
          created.sessionID === ctx.state.sessionID && created.name === input.name,
          "create should retain its owner and name",
        )
        const stored = Schema.decodeUnknownSync(Design.Info)(yield* json(ctx, "GET", `${ctx.state.root}/${created.id}`))
        check(stored.id === created.id, "create should persist a readable design")
        const owner = yield* json(ctx, "GET", `/api/session/${ctx.state.sessionID}`)
        object(owner)
        object(owner.data)
        check(owner.data.agent === "design", "creating a design should select the Design mode")
      }),
    ),
  http.protected
    .get(`${root}/review`, "v2.design.review")
    .seeded(session)
    .at((ctx) => ({ path: `${ctx.state.root}/review`, headers: ctx.headers() }))
    .status(200, (ctx, result) =>
      Effect.sync(() => {
        check(result.contentType.includes("text/html"), "review should return HTML")
        check(
          result.text.includes(ctx.state.sessionID) && result.text.includes('id="review"'),
          "review should bind the requested session",
        )
      }),
    ),
  http.protected
    .get(`${root}/whiteboard`, "v2.design.whiteboard")
    .seeded(session)
    .at((ctx) => ({ path: `${ctx.state.root}/whiteboard`, headers: ctx.headers() }))
    .status(200, (_ctx, result) =>
      Effect.sync(() => {
        check(result.contentType.includes("text/html"), "whiteboard should return HTML")
        check(
          result.text.includes("Content-Security-Policy") && result.text.includes("excalidraw"),
          "whiteboard should embed its distribution and isolation policy",
        )
      }),
    ),
  http.protected
    .get(item, "v2.design.get")
    .seeded(document)
    .at((ctx) => ({ path: ctx.state.item, headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      const stored = Schema.decodeUnknownSync(Design.Info)(body)
      check(
        stored.id === ctx.state.document.id && stored.sessionID === ctx.state.sessionID,
        "get should return the exact owned design",
      )
    }),
  http.protected
    .get(item, "v2.design.get.otherSession")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* document(ctx)
        const other = yield* session(ctx)
        return { ...current, other }
      }),
    )
    .at((ctx) => ({ path: `${ctx.state.other.root}/${ctx.state.document.id}`, headers: ctx.headers() }))
    .json(409, (body) => {
      const error = Schema.decodeUnknownSync(Design.Error)(body)
      check(error.code === "not-found", "a different session must not access the design")
    }),
  http.protected
    .patch(item, "v2.design.update")
    .seeded(document)
    .at((ctx) => ({
      path: ctx.state.item,
      headers: ctx.headers(),
      body: { name: "Updated checkout", tweaks: { "--accent": "cyan" } },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        const updated = Schema.decodeUnknownSync(Design.Info)(body)
        check(
          updated.id === ctx.state.document.id && updated.name === "Updated checkout",
          "update should retain identity",
        )
        const stored = Schema.decodeUnknownSync(Design.Info)(yield* json(ctx, "GET", ctx.state.item))
        check(stored.tweaks["--accent"] === "cyan", "update should persist design tweaks")
      }),
    ),
  http.protected
    .get(`${item}/revision`, "v2.design.revisions")
    .seeded(published)
    .at((ctx) => ({ path: `${ctx.state.item}/revision`, headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      const revisions = Schema.decodeUnknownSync(Schema.Array(Design.Revision))(body)
      check(
        revisions.length === 1 && revisions[0].id === ctx.state.revision.id,
        "history should contain the published revision",
      )
    }),
  http.protected
    .post(`${item}/revision`, "v2.design.publish")
    .seeded(document)
    .at((ctx) => ({ path: `${ctx.state.item}/revision`, headers: ctx.headers(), body: { name: "First direction" } }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        const revision = Schema.decodeUnknownSync(Design.Revision)(body)
        check(
          revision.designID === ctx.state.document.id && !!revision.files[ctx.state.document.entry],
          "publish should record an immutable snapshot",
        )
        const stored = Schema.decodeUnknownSync(Design.Info)(yield* json(ctx, "GET", ctx.state.item))
        check(stored.revision === revision.id, "publish should update the current revision")
      }),
    ),
  http.protected
    .get(`${item}/revision/{revisionID}/preview`, "v2.design.preview")
    .seeded(published)
    .at((ctx) => ({ path: `${ctx.state.item}/revision/${ctx.state.revision.id}/preview`, headers: ctx.headers() }))
    .status(200, (_ctx, result) =>
      Effect.sync(() => {
        check(
          result.contentType.includes("text/html") && result.text.includes("HTTP API checkout"),
          "preview should serve the published HTML",
        )
        check(result.text.includes("connect-src 'none'"), "preview should isolate external connections")
      }),
    ),
  http.protected
    .post(`${item}/restore`, "v2.design.restore")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* published(ctx)
        yield* Effect.promise(() =>
          Bun.write(path.join(current.document.root, current.document.entry), "Changed working copy"),
        )
        return current
      }),
    )
    .at((ctx) => ({
      path: `${ctx.state.item}/restore`,
      headers: ctx.headers(),
      body: { revision: ctx.state.revision.id },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        const restored = Schema.decodeUnknownSync(Design.Revision)(body)
        check(
          restored.id !== ctx.state.revision.id && restored.parent === ctx.state.revision.id,
          "restore should create a linked revision",
        )
        const content = yield* Effect.promise(() =>
          Bun.file(path.join(ctx.state.document.root, ctx.state.document.entry)).text(),
        )
        check(content === html, "restore should recover the immutable file bytes")
      }),
    ),
  http.protected
    .post(`${item}/approve`, "v2.design.approve")
    .seeded(published)
    .at((ctx) => ({
      path: `${ctx.state.item}/approve`,
      headers: ctx.headers(),
      body: { revision: ctx.state.revision.id },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        check(
          body.revision === ctx.state.revision.id && typeof body.plan === "string",
          "approval should identify its revision and plan",
        )
        const plan = body.plan
        const content = yield* Effect.promise(() => Bun.file(plan).text())
        check(content.includes(ctx.state.revision.id), "approval should write the handoff plan")
        const stored = Schema.decodeUnknownSync(Design.Info)(yield* json(ctx, "GET", ctx.state.item))
        check(
          stored.approvedRevision === ctx.state.revision.id && stored.ended,
          "approval should persist and end review",
        )
      }),
    ),
  http.protected
    .get(`${item}/approval/{revisionID}`, "v2.design.approval")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* published(ctx)
        yield* json(ctx, "POST", `${current.item}/approve`, { revision: current.revision.id })
        yield* json(ctx, "POST", `${current.item}/reopen`)
        yield* json(ctx, "PATCH", current.item, { name: "Unapproved draft" })
        return current
      }),
    )
    .at((ctx) => ({
      path: `${ctx.state.item}/approval/${ctx.state.revision.id}`,
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      const approval = Schema.decodeUnknownSync(Design.Approval)(body)
      check(
        approval.version === 1 && approval.approvedAt !== null && approval.variant === null,
        "approval should retain its recorded time and whole-revision selection",
      )
      check(
        approval.revision.id === ctx.state.revision.id &&
          approval.revision.designID === ctx.state.document.id &&
          approval.revision.document.name === ctx.state.document.name,
        "approval should preserve the owned snapshot after the working draft changes",
      )
    }),
  http.protected
    .post(`${item}/reopen`, "v2.design.reopen")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* published(ctx)
        yield* json(ctx, "POST", `${current.item}/approve`, { revision: current.revision.id })
        return current
      }),
    )
    .at((ctx) => ({ path: `${ctx.state.item}/reopen`, headers: ctx.headers() }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        const reopened = Schema.decodeUnknownSync(Design.Info)(body)
        check(!reopened.ended && reopened.id === ctx.state.document.id, "reopen should reactivate the same design")
        const updated = Schema.decodeUnknownSync(Design.Info)(
          yield* json(ctx, "PATCH", ctx.state.item, { name: "Reopened checkout" }),
        )
        check(updated.name === "Reopened checkout", "a reopened design should accept edits")
      }),
    ),
  http.protected
    .post(`${item}/refresh`, "v2.design.refresh")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* document(ctx)
        yield* ctx.file("DESIGN.md", "# Design system\nUse a cyan accent for checkout.")
        return current
      }),
    )
    .at((ctx) => ({ path: `${ctx.state.item}/refresh`, headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      const refreshed = Schema.decodeUnknownSync(Design.Info)(body)
      check(refreshed.id === ctx.state.document.id, "refresh should retain design identity")
      check(
        refreshed.sources.some((source) => source.file.endsWith("DESIGN.md") && source.excerpt.includes("cyan")),
        `refresh should discover changed product guidance in ${refreshed.application} from ${ctx.directory}: ${JSON.stringify(refreshed.sources)}`,
      )
    }),
  http.protected
    .post(`${item}/feedback`, "v2.design.feedback")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* published(ctx)
        return {
          ...current,
          feedback: {
            id: `msg_${crypto.randomUUID()}`,
            revision: current.revision.id,
            text: "Make checkout clearer",
            items: [{ target: "h1", text: "Use a clearer heading" }],
            assets: [],
            snapshot: "",
            delivery: "queue",
            end: false,
          },
        }
      }),
    )
    .at((ctx) => ({ path: `${ctx.state.item}/feedback`, headers: ctx.headers(), body: ctx.state.feedback }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        const receipt = Schema.decodeUnknownSync(Design.Receipt)(body)
        check(
          receipt.id === ctx.state.feedback.id && receipt.status === "admitted",
          "feedback should be durably admitted",
        )
        const retry = Schema.decodeUnknownSync(Design.Receipt)(
          yield* json(ctx, "POST", `${ctx.state.item}/feedback`, ctx.state.feedback),
        )
        check(
          retry.id === receipt.id && retry.status === "admitted",
          "an exact feedback retry should reconcile its receipt",
        )
      }),
    ),
  http.protected
    .get(`${item}/asset`, "v2.design.assets")
    .seeded(asset)
    .at((ctx) => ({ path: `${ctx.state.item}/asset`, headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      const assets = Schema.decodeUnknownSync(Schema.Array(Design.Asset))(body)
      check(assets.length === 1 && assets[0].id === ctx.state.asset.id, "assets should list the imported image")
    }),
  http.protected
    .post(`${item}/asset`, "v2.design.importAsset")
    .seeded(document)
    .at((ctx) => ({ path: `${ctx.state.item}/asset`, headers: ctx.headers(), body: media }))
    .json(200, (body, ctx) => {
      const imported = Schema.decodeUnknownSync(Design.Asset)(body)
      check(
        imported.designID === ctx.state.document.id && imported.mime === media.mime,
        "asset import should preserve ownership and type",
      )
      check(
        imported.bytes === Buffer.byteLength(svg) && /^[a-f0-9]{64}$/.test(imported.hash),
        "asset import should record size and content identity",
      )
    }),
  http.protected
    .get(`${item}/asset/{assetID}/file`, "v2.design.assetFile")
    .seeded(asset)
    .at((ctx) => ({ path: `${ctx.state.item}/asset/${ctx.state.asset.id}/file`, headers: ctx.headers() }))
    .status(200, (_ctx, result) =>
      Effect.sync(() => {
        check(
          result.contentType.includes("image/svg+xml") && result.text === svg,
          "asset download should preserve SVG bytes and MIME type",
        )
      }),
    ),
  http.protected
    .get(`${item}/job`, "v2.design.jobs")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* job(ctx)
        yield* completedJob(ctx, current.item, current.job.id)
        return current
      }),
    )
    .at((ctx) => ({ path: `${ctx.state.item}/job`, headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      const jobs = Schema.decodeUnknownSync(Schema.Array(Design.Job))(body)
      check(jobs.length === 1 && jobs[0].id === ctx.state.job.id, "jobs should list the recorded export")
    }),
  http.protected
    .post(`${item}/job`, "v2.design.render")
    .seeded(published)
    .at((ctx) => ({
      path: `${ctx.state.item}/job`,
      headers: ctx.headers(),
      body: { revision: ctx.state.revision.id, format: "html" },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        const started = Schema.decodeUnknownSync(Design.Job)(body)
        check(
          started.designID === ctx.state.document.id && started.input.revision === ctx.state.revision.id,
          "export should bind the exact revision",
        )
        const completed = yield* completedJob(ctx, ctx.state.item, started.id)
        check(
          completed.status === "completed" && completed.result !== null,
          "HTML export should complete with a result",
        )
      }),
    ),
  http.protected
    .post(`${item}/job/{jobID}/cancel`, "v2.design.cancel")
    .seeded(job)
    .at((ctx) => ({ path: `${ctx.state.item}/job/${ctx.state.job.id}/cancel`, headers: ctx.headers() }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        const cancelled = Schema.decodeUnknownSync(Design.Job)(body)
        check(cancelled.id === ctx.state.job.id, "cancel should target the requested export")
        check(
          cancelled.status === "cancelled" || cancelled.status === "completed",
          "cancel should stop work or preserve an already completed export",
        )
        const jobs = Schema.decodeUnknownSync(Schema.Array(Design.Job))(
          yield* json(ctx, "GET", `${ctx.state.item}/job`),
        )
        check(
          jobs.find((job) => job.id === cancelled.id)?.status === cancelled.status,
          "cancel should persist its terminal state",
        )
      }),
    ),
  http.protected
    .get(`${item}/job/{jobID}/file`, "v2.design.download")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* job(ctx)
        yield* completedJob(ctx, current.item, current.job.id)
        return current
      }),
    )
    .at((ctx) => ({ path: `${ctx.state.item}/job/${ctx.state.job.id}/file`, headers: ctx.headers() }))
    .status(200, (_ctx, result) =>
      Effect.sync(() => {
        check(
          result.contentType.includes("text/html") && result.text.includes("HTTP API checkout"),
          "download should serve the completed portable HTML",
        )
      }),
    ),
  http.protected
    .get("/api/session/{sessionID}/goal", "v2.goal.get")
    .seeded(session)
    .at((ctx) => ({ path: `/api/session/${ctx.state.sessionID}/goal`, headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(
        Schema.decodeUnknownSync(Schema.NullOr(SessionGoal.Info))(body.data) === null,
        "a new session should have no Goal",
      )
    }),
  http.protected
    .post("/api/session/{sessionID}/goal", "v2.goal.set")
    .seeded(session)
    .at((ctx) => ({
      path: `/api/session/${ctx.state.sessionID}/goal`,
      headers: ctx.headers(),
      body: { objective, agent: "plan", maxTurns: 1 },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        const goal = Schema.decodeUnknownSync(SessionGoal.Info)(body.data)
        check(
          goal.objective === objective && goal.turns.max === 1,
          "Goal creation should preserve objective and budget",
        )
        check(
          goal.stopAfter === "plan" && !goal.executePlan,
          "Plan Goal should not implicitly authorize implementation",
        )
        const paused = yield* json(ctx, "POST", `/api/session/${ctx.state.sessionID}/goal/control`, { action: "pause" })
        object(paused)
        const stored = Schema.decodeUnknownSync(SessionGoal.Info)(paused.data)
        check(
          stored.id === goal.id && stored.status === "paused",
          "Goal creation should persist a controllable identity",
        )
        const history = yield* json(ctx, "GET", `/api/session/${ctx.state.sessionID}/history`)
        check(JSON.stringify(history).includes(objective), "Goal creation should durably admit its prompt")
      }),
    ),
  http.protected
    .post("/api/session/{sessionID}/goal/control", "v2.goal.control")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const current = yield* session(ctx)
        const body = yield* json(ctx, "POST", `/api/session/${current.sessionID}/goal`, {
          objective,
          agent: "plan",
          maxTurns: 1,
        })
        object(body)
        const goal = Schema.decodeUnknownSync(SessionGoal.Info)(body.data)
        yield* json(ctx, "POST", `/api/session/${current.sessionID}/goal/control`, { action: "pause" })
        return { ...current, goal }
      }),
    )
    .at((ctx) => ({
      path: `/api/session/${ctx.state.sessionID}/goal/control`,
      headers: ctx.headers(),
      body: { action: "budget", maxTurns: 3 },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        const goal = Schema.decodeUnknownSync(SessionGoal.Info)(body.data)
        check(
          goal.id === ctx.state.goal.id && goal.turns.max === 3 && goal.status === "paused",
          "budget control should preserve Goal identity and pause",
        )
        yield* json(ctx, "POST", `/api/session/${ctx.state.sessionID}/goal/control`, { action: "drop" })
        const dropped = yield* json(ctx, "GET", `/api/session/${ctx.state.sessionID}/goal`)
        object(dropped)
        check(dropped.data === null, "dropping a Goal should clear current state")
      }),
    ),
  http.protected
    .get("/api/session/{sessionID}/plan", "v2.goal.plans")
    .seeded(session)
    .at((ctx) => ({ path: `/api/session/${ctx.state.sessionID}/plan`, headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(
        Schema.decodeUnknownSync(Schema.Array(SessionPlan.Info))(body.data).length === 0,
        "a new session should have an empty plan history",
      )
    }),
]

function json(ctx: ScenarioContext, method: Method, path: string, body?: unknown) {
  return request(method, { path, headers: ctx.headers(), body }).pipe(
    Effect.map((result) => {
      check(result.status === 200, `${method} ${path}: ${result.status} ${result.text}`)
      check(result.contentType.includes("application/json"), `${path} should return JSON`)
      return result.body
    }),
  )
}

function session(ctx: ScenarioContext) {
  return Effect.gen(function* () {
    const body = yield* json(ctx, "POST", "/api/session", { location: { directory: ctx.directory }, agent: "plan" })
    object(body)
    object(body.data)
    check(typeof body.data.id === "string", "session seed should return an ID")
    return { sessionID: body.data.id, root: `/api/session/${body.data.id}/design` }
  })
}

function document(ctx: ScenarioContext) {
  return Effect.gen(function* () {
    const current = yield* session(ctx)
    const document = Schema.decodeUnknownSync(Design.Info)(yield* json(ctx, "POST", current.root, input))
    yield* Effect.promise(() => Bun.write(path.join(document.root, document.entry), html))
    return { ...current, document, item: `${current.root}/${document.id}` }
  })
}

function published(ctx: ScenarioContext) {
  return Effect.gen(function* () {
    const current = yield* document(ctx)
    const revision = Schema.decodeUnknownSync(Design.Revision)(
      yield* json(ctx, "POST", `${current.item}/revision`, { name: "First direction" }),
    )
    return { ...current, revision }
  })
}

function asset(ctx: ScenarioContext) {
  return Effect.gen(function* () {
    const current = yield* document(ctx)
    const asset = Schema.decodeUnknownSync(Design.Asset)(yield* json(ctx, "POST", `${current.item}/asset`, media))
    return { ...current, asset }
  })
}

function job(ctx: ScenarioContext) {
  return Effect.gen(function* () {
    const current = yield* published(ctx)
    const job = Schema.decodeUnknownSync(Design.Job)(
      yield* json(ctx, "POST", `${current.item}/job`, { revision: current.revision.id, format: "html" }),
    )
    return { ...current, job }
  })
}

function completedJob(ctx: ScenarioContext, item: string, id: string) {
  return json(ctx, "GET", `${item}/job`).pipe(
    Effect.map((body) => {
      const job = Schema.decodeUnknownSync(Schema.Array(Design.Job))(body).find((job) => job.id === id)
      check(job !== undefined, "the export must remain visible while running")
      return job
    }),
    Effect.repeat({
      while: (job) => job.status === "queued" || job.status === "running",
      schedule: Schedule.spaced("25 millis"),
    }),
    Effect.tap((job) =>
      Effect.sync(() => check(job.status === "completed", `export failed: ${job.error ?? job.status}`)),
    ),
  )
}
