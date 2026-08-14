import { Global } from "@opencode-ai/core/global"
import { Redskilled } from "@opencode-ai/schema/redskilled"
import { InstanceState } from "@/effect/instance-state"
import { MCP } from "@/mcp"
import type { InstanceContext } from "@/project/instance-context"
import { readPayload, readStatusline } from "@/redskilled/client"
import { decode, encode, type JsonValue } from "@reddb-io/toon"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { chmod } from "node:fs/promises"
import path from "node:path"
import { InstanceHttpApi } from "../api"

const consentFile = path.join(Global.Path.state, "redskilled-consent.toon")
const lastGood = new Map<string, { payload: Redskilled.Payload; render?: Redskilled.Status["render"]; at: string }>()
const paused = new Set<string>()

export const redskilledHandlers = HttpApiBuilder.group(InstanceHttpApi, "redskilled", (handlers) =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service

    const status = (scope: Redskilled.Scope = "project") =>
      Effect.gen(function* () {
        const context = yield* InstanceState.context
        const client = (yield* mcp.clients()).redskilled
        return yield* Effect.tryPromise({
          try: () => snapshot(context, client, scope),
          catch: () => new HttpApiError.BadRequest({}),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Redskilled.Status)),
          Effect.mapError(() => new HttpApiError.BadRequest({})),
        )
      })

    const mutate = (tool: string, input: Record<string, unknown>, worker?: string) =>
      Effect.gen(function* () {
        const context = yield* InstanceState.context
        if ((yield* Effect.promise(() => readConsent(context.project.id))) !== "accepted") {
          return yield* new HttpApiError.BadRequest({})
        }
        if (worker) {
          const current = yield* status("host")
          const mine = current.payload?.workers.some(
            (item) => item.worker_id === worker && item.project_label === current.activation?.project,
          )
          if (!mine) return yield* new HttpApiError.BadRequest({})
        }
        const client = (yield* mcp.clients()).redskilled
        yield* Effect.tryPromise({
          try: () => callTool(client, tool, input, 10_000),
          catch: () => new HttpApiError.BadRequest({}),
        })
        return yield* status("project")
      })

    const steerStatus = (worker: string) =>
      Effect.gen(function* () {
        const current = yield* status("host")
        if (current.consent !== "accepted") return yield* new HttpApiError.BadRequest({})
        if (
          !current.payload?.workers.some(
            (item) => item.worker_id === worker && item.project_label === current.activation?.project,
          )
        )
          return yield* new HttpApiError.BadRequest({})
        const client = (yield* mcp.clients()).redskilled
        return yield* Effect.tryPromise({
          try: () => callTool(client, "steer_status", { worker }, 2_000),
          catch: () => new HttpApiError.BadRequest({}),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Redskilled.SteerStatus)),
          Effect.mapError(() => new HttpApiError.BadRequest({})),
        )
      })

    return handlers
      .handle("status", (ctx) => status(ctx.query.scope ?? "project"))
      .handle("consent", (ctx) =>
        Effect.gen(function* () {
          const context = yield* InstanceState.context
          const previous = yield* Effect.promise(() => readConsent(context.project.id))
          yield* Effect.promise(() => writeConsent(context.project.id, ctx.payload.decision))
          if (ctx.payload.decision === "accepted") {
            paused.delete(context.project.id)
            const client = (yield* mcp.clients()).redskilled
            yield* Effect.tryPromise({
              try: () => callTool(client, "drain", {}, 10_000),
              catch: () => new HttpApiError.BadRequest({}),
            })
            return yield* status("project")
          }
          paused.add(context.project.id)
          if (previous === "accepted") {
            const client = (yield* mcp.clients()).redskilled
            yield* Effect.tryPromise({
              try: () => callTool(client, "project_stop", {}, 10_000),
              catch: () => new HttpApiError.BadRequest({}),
            })
          }
          return yield* status("project")
        }),
      )
      .handle("resize", (ctx) => mutate("project_resize", { target: ctx.payload.target }))
      .handle("stopProject", () =>
        Effect.gen(function* () {
          paused.add((yield* InstanceState.context).project.id)
          return yield* mutate("project_stop", {})
        }),
      )
      .handle("stopWorker", (ctx) => mutate("worker_stop", { worker: ctx.payload.worker }, ctx.payload.worker))
      .handle("recycleWorker", (ctx) => mutate("worker_recycle", { worker: ctx.payload.worker }, ctx.payload.worker))
      .handle("steerWorker", (ctx) => mutate("runner_steer", ctx.payload, ctx.payload.worker))
      .handle("steerStatus", (ctx) => steerStatus(ctx.payload.worker))
  }),
)

async function snapshot(context: InstanceContext, client: Client | undefined, scope: Redskilled.Scope) {
  const consent = await readConsent(context.project.id)
  const activation = await callTool(client, "project_activation", {}, 2_000)
    .then(Schema.decodeUnknownSync(Redskilled.Activation))
    .catch(() => undefined)
  const key = `${context.project.id}:${scope}`

  if (activation?.eligible && consent === "accepted" && !paused.has(context.project.id)) {
    const observed = await readPayload(activation.project).catch(() => undefined)
    const decoded = decodePayload(observed, activation.project, scope)
    if (!decoded || !decoded.registered_projects?.includes(activation.project))
      await callTool(client, "drain", {}, 10_000)
  }

  const [raw, render] = await Promise.all([
    readPayload(activation?.project).catch((error) => error),
    readStatusline(activation?.project, scope === "host").catch(() => undefined),
  ])
  if (!(raw instanceof Error)) {
    const payload = decodePayload(raw, activation?.project, scope)
    if (payload) {
      const at = new Date().toISOString()
      lastGood.set(key, { payload, ...(render ? { render } : {}), at })
      return {
        lifecycle: lifecycle(consent, activation, payload.staleness.stale),
        consent,
        scope,
        native: true as const,
        ...(activation ? { activation } : {}),
        payload,
        ...(render ? { render } : {}),
        last_success_at: at,
      }
    }
  }

  const cached = lastGood.get(key)
  return {
    lifecycle: activation ? lifecycle(consent, activation, true) : ("unavailable" as const),
    consent,
    scope,
    native: true as const,
    ...(activation ? { activation } : {}),
    ...(cached
      ? { payload: cached.payload, ...(cached.render ? { render: cached.render } : {}), last_success_at: cached.at }
      : {}),
    error: raw instanceof Error ? raw.message : "redskilled returned an invalid payload",
  }
}

async function callTool(client: Client | undefined, name: string, input: Record<string, unknown>, timeout: number) {
  if (!client) throw new Error("redskilled MCP is not connected")
  const result = await client.callTool({ name, arguments: input }, undefined, { timeout })
  if (result.isError)
    throw new Error(result.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n"))
  const text = result.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
  if (!text) throw new Error(`redskilled ${name} returned no structured output`)
  return text.trimStart().startsWith("{") ? (JSON.parse(text) as unknown) : (decode(text) as unknown)
}

function decodePayload(value: unknown, project: string | undefined, scope: Redskilled.Scope) {
  const decoded = Schema.decodeUnknownOption(Redskilled.Payload)(value)
  if (decoded._tag === "None") return
  if (scope === "host" || !project) return decoded.value
  return { ...decoded.value, workers: decoded.value.workers.filter((worker) => worker.project_label === project) }
}

function lifecycle(
  consent: Redskilled.Consent,
  activation: Redskilled.Activation | undefined,
  stale: boolean,
): Redskilled.Lifecycle {
  if (!activation) return "unavailable"
  if (!activation.eligible) return "ineligible"
  if (consent === "refused") return "refused"
  if (consent === "unknown") return "needs_consent"
  return stale ? "degraded" : "live"
}

async function readConsent(projectID: string): Promise<Redskilled.Consent> {
  const file = Bun.file(consentFile)
  if (!(await file.exists())) return "unknown"
  const value = decodeConsent(await file.text())
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "unknown"
  const consent = (value as Record<string, unknown>)[projectID]
  return consent === "accepted" || consent === "refused" ? consent : "unknown"
}

async function writeConsent(projectID: string, consent: Exclude<Redskilled.Consent, "unknown">) {
  const file = Bun.file(consentFile)
  const current = (await file.exists()) ? decodeConsent(await file.text()) : {}
  const values = typeof current === "object" && current !== null && !Array.isArray(current) ? current : {}
  await Bun.write(consentFile, `${encode({ ...values, [projectID]: consent } as JsonValue)}\n`)
  await chmod(consentFile, 0o600)
}

function decodeConsent(text: string): unknown {
  try {
    return decode(text) as unknown
  } catch {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return {}
    }
  }
}
