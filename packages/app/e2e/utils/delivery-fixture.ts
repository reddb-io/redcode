import type { Page } from "@playwright/test"
import type { MonitorPublicInfo } from "@opencode/client/promise"
import { Schema } from "effect"
import { AbsolutePath } from "@opencode/schema/schema"
import { currentSession } from "./mock-server"
import { fixture } from "./session-fixture"
import { mockHarnessOperations } from "./agent-operation-fixture"

/** Shared API fixture for durable annotations and explicit, admit-only skill activation. */
export async function mockDeliveryResources(page: Page) {
  const state = {
    metadata: { owner: "keep-this-annotation" } as Schema.JsonObject,
    failSave: false,
    failSkill: false,
    writes: [] as { sessionID: string; metadata: Schema.JsonObject }[],
    skills: [] as { sessionID: string; id: string; resume?: boolean }[],
    detailReads: [] as string[],
    harnessWrites: [] as string[],
  }
  await mockHarnessOperations(page, {
    output: "Native review is waiting for your answer.",
    runs: [
      {
        id: "delivery-codex",
        driver: "codex",
        directory: AbsolutePath.make(fixture.directory),
        nativeID: "codex-thread-123",
        state: "waiting",
        createdAt: "2026-10-26T12:00:00Z",
        queued: 0,
        capabilities: { steer: true, resume: true, interrupt: true },
      },
      {
        id: "delivery-claude",
        driver: "claude",
        directory: AbsolutePath.make(fixture.directory),
        nativeID: "claude-session-456",
        state: "ready",
        createdAt: "2026-10-26T12:00:00Z",
        queued: 0,
        capabilities: { steer: false, resume: true, interrupt: true },
      },
    ],
  })
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith("/api/harness") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      state.harnessWrites.push(request.method() + " " + new URL(request.url()).pathname)
    if (request.method() === "GET" && /\/api\/harness\/runs\//.test(new URL(request.url()).pathname))
      state.detailReads.push(new URL(request.url()).pathname)
  })
  await page.route(/\/api\/session\/[^/?]+(?:\?.*)?$/, async (route) => {
    const request = route.request()
    const sessionID = new URL(request.url()).pathname.split("/").at(-1)!
    const session = fixture.sessions.find((item) => item.id === sessionID)
    if (!session) return route.fallback()
    if (request.method() === "GET")
      return route.fulfill({
        json: {
          data: {
            ...currentSession(session, fixture.directory),
            ...(sessionID === fixture.sourceID ? { metadata: state.metadata } : {}),
          },
        },
      })
    if (request.method() !== "PATCH") return route.fallback()
    if (state.failSave) return route.fulfill({ status: 500, json: { message: "Could not save metadata" } })
    const body = Schema.decodeUnknownSync(Schema.Struct({ metadata: Schema.Record(Schema.String, Schema.Json) }))(
      request.postDataJSON(),
    )
    state.metadata = { ...body.metadata }
    state.writes.push({ sessionID, metadata: state.metadata })
    return route.fulfill({ status: 204 })
  })
  await page.route("**/api/experimental/session/*/skill", async (route) => {
    if (state.failSkill) return route.fulfill({ status: 500, json: { message: "Could not load skill" } })
    const body = Schema.decodeUnknownSync(
      Schema.Struct({ id: Schema.String, resume: Schema.optionalKey(Schema.Boolean) }),
    )(route.request().postDataJSON())
    state.skills.push({ sessionID: new URL(route.request().url()).pathname.split("/").at(-2)!, ...body })
    return route.fulfill({ status: 204 })
  })
  return state
}

export const deliverySkills = [
  {
    id: "review-local",
    name: "Review local changes",
    description: "Inspect local changes and record verification before handoff.",
    autoinvoke: false,
    path: fixture.directory + "/.agents/skills/review-local/SKILL.md",
    content:
      "# Local review\nInspect the diff, run the project checks and report unresolved issues.\nDo not merge or publish from this skill.",
  },
]

/** Session-owned monitor observations and explicit local cancellation. */
export async function mockDeliveryMonitors(page: Page) {
  const monitor = (sessionID: string, id: string): MonitorPublicInfo => ({
    id,
    sessionID,
    command: "Wait for deployment readiness",
    workdir: fixture.directory,
    options: { mode: "poll", interval_ms: 5000, deadline_ms: 120000 },
    status: "running",
    created: 1793016000000,
    updated: 1793016005000,
    attempts: 2,
    evidence: { exit: 0, output: "Deployment still pending", truncated: false },
    delivery: "pending",
  })
  const state = {
    monitors: [monitor(fixture.sourceID, "monitor-parent"), monitor(fixture.childID, "monitor-child")],
    reads: [] as string[],
    cancellations: [] as { sessionID: string; monitorID: string }[],
    unavailable: false,
    cancelFailed: false,
  }
  await page.route(/\/api\/session\/[^/?]+\/monitor(?:\/[^/?]+\/cancel)?(?:\?.*)?$/, (route) => {
    const parts = new URL(route.request().url()).pathname.split("/")
    const sessionID = parts[3]
    if (route.request().method() === "GET") {
      state.reads.push(sessionID)
      if (state.unavailable) return route.fulfill({ status: 503, json: { message: "Monitor unavailable" } })
      return route.fulfill({ json: { data: state.monitors.filter((item) => item.sessionID === sessionID) } })
    }
    const monitorID = parts[5]
    const found = state.monitors.find((item) => item.id === monitorID && item.sessionID === sessionID)
    if (!found) return route.fulfill({ status: 404, json: { message: "Monitor not found" } })
    state.cancellations.push({ sessionID, monitorID })
    if (state.cancelFailed) return route.fulfill({ status: 500, json: { message: "Could not cancel monitor" } })
    found.status = "cancelled"
    found.delivery = "suppressed"
    return route.fulfill({ json: { data: found } })
  })
  return state
}
