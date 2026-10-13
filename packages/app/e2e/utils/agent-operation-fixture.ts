import type { Page } from "@playwright/test"
import { Schema } from "effect"
import { Harness } from "@opencode/schema/harness"
import { Worktree } from "@opencode/schema/worktree"
import { AbsolutePath } from "@opencode/schema/schema"
import { fixture } from "./session-fixture"

export async function mockMachineInspection(page: Page) {
  await page.route("**/api/system", (route) =>
    route.fulfill({
      json: {
        version: "fixture",
        runtime: "bun",
        platform: "linux arm64",
        pid: 1,
        started: 1,
        memory: 1024,
        urls: [new URL(route.request().url()).origin],
        paths: { config: "/config", data: "/data", state: "/state", cache: "/cache", log: "/log", tmp: "/tmp" },
        database: { kind: "memory" },
      },
    }),
  )
}

export async function mockHarnessOperations(page: Page) {
  const state = {
    runs: [] as Harness.Run[],
    requests: [] as Harness.Request[],
  }
  await page.route("**/api/harness**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    const run = state.runs.find((item) => pathname.includes(item.id))
    if (pathname === "/api/harness")
      return route.fulfill({
        json: {
          providers: ["codex", "claude"].map((driver) => ({
            driver,
            executable: driver,
            installed: true,
            version: "fixture",
            authenticated: true,
          })),
          runs: state.runs,
        },
      })
    if (pathname === "/api/harness/runs" && request.method() === "POST") {
      const input = Schema.decodeUnknownSync(Harness.Open)(request.postDataJSON())
      const run: Harness.Run = {
        ...input,
        id: "native-run",
        nativeID: "provider-session",
        state: "ready",
        createdAt: "2026-10-13T12:00:00Z",
        queued: 0,
        capabilities: { steer: input.driver === "codex", resume: true, interrupt: true },
      }
      state.runs.push(run)
      return route.fulfill({ json: run })
    }
    if (pathname.endsWith("/prompt") && run) {
      Schema.decodeUnknownSync(Harness.Prompt)(request.postDataJSON())
      state.runs = state.runs.map((item) => ({ ...item, state: "waiting" }))
      state.requests = [
        {
          id: "question-native",
          kind: "question",
          title: "Implementation question",
          detail: "",
          questions: [{ id: "choice", text: "Which implementation?", options: ["Small", "Large"] }],
        },
      ]
      return route.fulfill({ status: 200 })
    }
    if (pathname.endsWith("/answer")) {
      state.requests = []
      state.runs = state.runs.map((item) => ({ ...item, state: "ready" }))
      return route.fulfill({ status: 200 })
    }
    if (pathname.endsWith("/reconcile") && run) {
      const reconciled = { ...run, state: "interrupted" }
      state.runs = state.runs.map((item) => (item.id === run.id ? { ...item, state: "interrupted" } : item))
      return route.fulfill({ json: reconciled })
    }
    if (pathname.endsWith("/interrupt")) {
      state.runs = state.runs.map((item) => ({ ...item, state: "interrupted" }))
      return route.fulfill({ status: 200 })
    }
    if (request.method() === "DELETE" && run) {
      state.runs = state.runs.map((item) => ({ ...item, state: "closed" }))
      return route.fulfill({ status: 200 })
    }
    if (run)
      return route.fulfill({
        json: { run, events: [{ cursor: 1, kind: "text", text: "Native harness output" }], requests: state.requests },
      })
    return route.fulfill({ status: 400, json: { message: "Unsupported fixture operation" } })
  })
  return {
    loseProcess: () => {
      state.runs = state.runs.map((item) => ({ ...item, state: "unknown" }))
    },
  }
}

export async function mockWorktreeOperations(page: Page) {
  const child = fixture.directory + "/worktree-agent"
  const state = { created: false, archived: false }
  const archive = {
    reference: "refs/redcode/archives/fixture",
    head: "a".repeat(40),
    createdAt: "2026-10-13T12:00:00Z",
  }
  await page.route("**/api/worktree**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === "/api/worktree" && request.method() === "GET")
      return route.fulfill({
        json: [
          { directory: fixture.directory },
          ...(state.created && !state.archived ? [{ directory: child, strategy: "git" }] : []),
        ],
      })
    if (pathname === "/api/worktree" && request.method() === "POST") {
      Schema.decodeUnknownSync(Worktree.CreateInput)(request.postDataJSON())
      state.created = true
      state.archived = false
      return route.fulfill({ json: { directory: child } })
    }
    if (pathname.endsWith("/archives")) return route.fulfill({ json: state.archived ? [archive] : [] })
    if (pathname.endsWith("/inspect")) {
      const input = Schema.decodeUnknownSync(Worktree.InspectInput)(request.postDataJSON())
      return route.fulfill({
        json: {
          ...input,
          directory: child,
          branch: null,
          head: archive.head,
          targetHead: "b".repeat(40),
          dirty: false,
          targetDirty: false,
          status: "",
          diff: "+ agent result",
          truncated: false,
          managed: true,
        },
      })
    }
    if (pathname.endsWith("/integrate")) {
      const input = Schema.decodeUnknownSync(Worktree.IntegrateInput)(request.postDataJSON())
      return route.fulfill({
        json: {
          ...input,
          branch: null,
          dirty: false,
          targetDirty: false,
          status: "",
          diff: "",
          truncated: false,
          managed: true,
        },
      })
    }
    if (pathname.endsWith("/archive")) {
      Schema.decodeUnknownSync(Worktree.ArchiveInput)(request.postDataJSON())
      state.archived = true
      return route.fulfill({ json: archive })
    }
    return route.fulfill({ status: 400, json: { message: "Unsupported fixture operation" } })
  })
  return { directory: AbsolutePath.make(child) }
}
