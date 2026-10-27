import type { Page } from "@playwright/test"
import type { AutomationInfo, AutomationRun, HookStatus, MonitorPublicInfo } from "@opencode/client/promise"
import { Automation } from "@opencode/schema/automation"
import type { Harness } from "@opencode/schema/harness"
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
    nativeUnavailable: false,
    nativeTasks: {} as Record<string, Harness.Task[]>,
  }
  await mockHarnessOperations(page, {
    tasks: state.nativeTasks,
    unavailable: () => state.nativeUnavailable,
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

/** Explicitly linked native observations; shared checkout alone must not select another run. */
export async function mockDeliveryNativeTasks(page: Page) {
  const state = await mockDeliveryResources(page)
  state.metadata = {
    ...state.metadata,
    "redcode.delivery": {
      version: 1,
      pullRequests: [],
      harnesses: [
        { runID: "delivery-claude", driver: "claude" },
        { runID: "delivery-codex", driver: "codex" },
      ],
    },
  }
  state.nativeTasks["delivery-claude"] = [
    {
      id: "task-same-id",
      kind: "monitor",
      status: "running",
      nativeType: "local_bash",
      title: "Observe native deployment",
      output: "Native deployment pending",
      truncated: false,
      toolUseID: "tool-monitor",
      parentTaskID: "parent-native-agent",
      updatedAt: 1793016005000,
      wait: {
        id: "wait-deployment",
        state: "waiting",
        startedAt: 1793016005000,
        deadlineAt: 1793016035000,
      },
    },
  ]
  state.nativeTasks["delivery-codex"] = [
    {
      id: "task-same-id",
      kind: "command",
      status: "succeeded",
      nativeType: "commandExecution",
      title: "Native build verification",
      output: "Native build passed",
      truncated: false,
      processID: "pty-42",
      updatedAt: 1793016005000,
    },
  ]
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

/** Project-scoped hook trust and explicit configuration import, without executing commands. */
export async function mockDeliveryHooks(page: Page) {
  const state = {
    reads: [] as string[],
    writes: [] as { action: string; directory: string }[],
    scopes: new Map<string, HookStatus>(),
    unavailable: false,
    failChange: false,
  }
  await page.route(/\/api\/hook(?:\/trust|\/import\/claude)?(?:\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    const directory = url.searchParams.get("location[directory]") ?? ""
    const status =
      state.scopes.get(directory) ??
      ({
        trust: { trusted: false, fingerprint: "fixture-hooks-v1" },
        definitions: [
          {
            id: "command",
            event: "PreToolUse",
            matcher: "Bash",
            source: directory + "/redcode.json",
            handler: { type: "command", command: "bun run verify-project", timeout: 30 },
            support: "untrusted",
          },
          {
            id: "http",
            event: "PostToolUse",
            source: directory + "/redcode.json",
            handler: {
              type: "http",
              url: "https://hooks.example.test/events",
              headers: { Authorization: "fixture-hidden-header" },
            },
            support: "untrusted",
          },
          {
            id: "unsupported",
            event: "Stop",
            source: directory + "/redcode.json",
            handler: { type: "prompt", prompt: "Review the result" },
            support: "unsupported",
            reason: "Handler type prompt is not available in this host",
          },
        ],
      } satisfies HookStatus)
    state.scopes.set(directory, status)
    if (route.request().method() === "GET") {
      state.reads.push(directory)
      if (state.unavailable) return route.fulfill({ status: 503, json: { message: "Hooks unavailable" } })
      return route.fulfill({ json: { location: { directory }, data: status } })
    }
    const action = url.pathname.endsWith("/claude")
      ? "import"
      : route.request().method() === "DELETE"
        ? "revoke"
        : "trust"
    state.writes.push({ action, directory })
    if (state.failChange) return route.fulfill({ status: 500, json: { message: "Hook action failed" } })
    if (action === "import")
      return route.fulfill({
        json: {
          location: { directory },
          data: { imported: 2, target: directory + "/redcode.json", restart_required: true },
        },
      })
    status.trust.trusted = action === "trust"
    status.definitions = status.definitions.map((item) =>
      item.support === "unsupported" ? item : { ...item, support: status.trust.trusted ? "active" : "untrusted" },
    )
    return route.fulfill({ json: { location: { directory }, data: status.trust } })
  })
  return state
}

/** Conversation-owned schedules and explicit prompt-admission receipts for the Delivery keeper. */
export async function mockDeliveryAutomations(page: Page) {
  const now = Date.now()
  const state = {
    items: [
      {
        id: "auto_parent",
        sessionID: fixture.sourceID,
        title: "Parent schedule",
        prompt: "Parent only",
        schedule: { type: "interval", everyMs: 60000 },
        enabled: true,
        nextAt: now + 60000,
        created: now,
        updated: now,
      },
    ] as AutomationInfo[],
    runs: [] as AutomationRun[],
    reads: [] as string[],
    historyReads: [] as string[],
    creates: [] as { sessionID: string; input: Automation.Input }[],
    controls: [] as { sessionID: string; id: string; enabled: boolean }[],
    triggers: [] as { sessionID: string; id: string; runID: Automation.RunID }[],
    removals: [] as { sessionID: string; id: string }[],
    unavailable: false,
    failRun: false,
  }
  await page.route(
    /\/api\/session\/[^/?]+\/automation(?:\/[^/?]+(?:\/control|\/run|\/history)?)?(?:\?.*)?$/,
    (route) => {
      const parts = new URL(route.request().url()).pathname.split("/")
      const sessionID = parts[3]
      const automationID = parts[5]
      const method = route.request().method()
      if (method === "GET" && !automationID) {
        state.reads.push(sessionID)
        if (state.unavailable) return route.fulfill({ status: 503, json: { message: "Schedules unavailable" } })
        return route.fulfill({ json: { data: state.items.filter((item) => item.sessionID === sessionID) } })
      }
      if (method === "POST" && !automationID) {
        const input = Schema.decodeUnknownSync(Automation.Input)(route.request().postDataJSON())
        state.creates.push({ sessionID, input })
        const item: AutomationInfo = {
          ...input,
          schedule:
            input.schedule.type === "fixed_time"
              ? { ...input.schedule, weekdays: [...input.schedule.weekdays] }
              : input.schedule,
          sessionID,
          enabled: true,
          nextAt:
            input.schedule.type === "once"
              ? input.schedule.at
              : input.schedule.type === "interval"
                ? Date.now() + input.schedule.everyMs
                : Date.parse("2030-01-07T12:00:00Z"),
          created: Date.now(),
          updated: Date.now(),
        }
        state.items.push(item)
        return route.fulfill({ json: { data: item } })
      }
      const item = state.items.find((entry) => entry.id === automationID && entry.sessionID === sessionID)
      if (!item) return route.fulfill({ status: 404, json: { message: "Automation not found" } })
      if (parts[6] === "history") {
        state.historyReads.push(automationID)
        return route.fulfill({ json: { data: state.runs.filter((run) => run.automationID === automationID) } })
      }
      if (parts[6] === "control") {
        const body = Schema.decodeUnknownSync(Schema.Struct({ enabled: Schema.Boolean }))(
          route.request().postDataJSON(),
        )
        state.controls.push({ sessionID, id: automationID, enabled: body.enabled })
        item.enabled = body.enabled
        return route.fulfill({ json: { data: item } })
      }
      if (parts[6] === "run") {
        const body = Schema.decodeUnknownSync(Schema.Struct({ id: Automation.RunID }))(route.request().postDataJSON())
        state.triggers.push({ sessionID, id: automationID, runID: body.id })
        if (state.failRun) return route.fulfill({ status: 500, json: { message: "Admission unavailable" } })
        const run: AutomationRun = {
          id: body.id,
          automationID,
          inboxID: `msg_${body.id}`,
          trigger: "manual",
          scheduledAt: Date.now(),
          created: Date.now(),
          updated: Date.now(),
          status: "admitted",
          error: null,
        }
        state.runs.push(run)
        return route.fulfill({ json: { data: run } })
      }
      state.removals.push({ sessionID, id: automationID })
      state.items = state.items.filter((entry) => entry.id !== automationID)
      return route.fulfill({ status: 204 })
    },
  )
  return state
}
