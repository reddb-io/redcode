import type { Page } from "@playwright/test"
import { Schema } from "effect"
import { Harness } from "@opencode/schema/harness"
import { Worktree } from "@opencode/schema/worktree"
import { AbsolutePath } from "@opencode/schema/schema"
import { WorkerEnvironment } from "@opencode/schema/worker-environment"
import { ProjectEnvironment } from "@opencode/schema/project-environment"
import { fixture } from "./session-fixture"

export async function mockProjectEnvironments(page: Page) {
  const recipes: ProjectEnvironment.Recipe[] = []
  const environments: ProjectEnvironment.Info[] = []
  const operations: ProjectEnvironment.Run[] = []
  await page.route("**/api/project-environments**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === "GET")
      return route.fulfill({
        json: {
          directory: url.searchParams.get("directory"),
          projectID: fixture.project.id,
          recipes,
          environments,
        },
      })
    if (url.pathname.endsWith("/recipes")) {
      const input = Schema.decodeUnknownSync(ProjectEnvironment.Save)(request.postDataJSON())
      const existing = recipes.findIndex((item) => item.id === input.definition.id)
      const recipe: ProjectEnvironment.Recipe = {
        ...input.definition,
        projectID: fixture.project.id,
        revision: input.expectedRevision + 1,
        updatedAt: "2026-10-16T12:00:00Z",
      }
      if (existing >= 0) recipes[existing] = recipe
      else recipes.push(recipe)
      return route.fulfill({ json: recipe })
    }
    const input = Schema.decodeUnknownSync(ProjectEnvironment.Run)(request.postDataJSON())
    operations.push(input)
    const info: ProjectEnvironment.Info = {
      id: "fixture-stack",
      recipeID: input.recipeID,
      projectID: fixture.project.id,
      directory: input.directory,
      revision: input.revision,
      composeProject: "redcode-fixture-stack",
      action: input.action,
      state: input.action === "stop" ? "stopped" : "ready",
      requestID: input.requestID,
      output: "Application checks passed",
      updatedAt: "2026-10-16T12:01:00Z",
      validatedAt: "2026-10-16T12:01:00Z",
    }
    environments.splice(0, environments.length, info)
    return route.fulfill({ json: info })
  })
  return { operations }
}

export async function mockWorkerEnvironments(page: Page) {
  const environments: WorkerEnvironment.Info[] = []
  await page.route("**/api/integration", (route) =>
    route.fulfill({
      json: {
        location: { directory: fixture.directory },
        data: [{ id: "anthropic", name: "Anthropic", methods: [{ type: "key" }], connections: [] }],
      },
    }),
  )
  await page.route("**/api/worker-environments**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === "GET")
      return route.fulfill({ json: { available: true, engine: "linux fixture", environments } })
    if (url.pathname.endsWith("/image")) return route.fulfill({ json: { image: "redcode-worker:0.80.0" } })
    if (url.pathname === "/api/worker-environments" && request.method() === "POST") {
      const input = Schema.decodeUnknownSync(WorkerEnvironment.Create)(request.postDataJSON())
      const info: WorkerEnvironment.Info = {
        id: input.id,
        repository: input.repository,
        ref: input.ref,
        image: input.image,
        cpu: input.cpu,
        memoryMiB: input.memoryMiB,
        directory: "/workspace/project",
        state: "ready",
        phase: "complete",
        createdAt: "2026-10-13T12:00:00Z",
        commit: "a".repeat(40),
      }
      environments.push(info)
      return route.fulfill({ json: info })
    }
    const environment = environments.find((item) => url.pathname.includes(`/${item.id}`))
    if (!environment) return route.fulfill({ status: 404, json: { message: "Missing fixture environment" } })
    if (url.pathname.endsWith("/stop")) {
      Object.assign(environment, { state: "stopped" })
      return route.fulfill({ json: environment })
    }
    if (url.pathname.endsWith("/start")) {
      Object.assign(environment, { state: "ready" })
      return route.fulfill({ json: environment })
    }
    if (url.pathname.endsWith("/register"))
      return route.fulfill({
        json: {
          connection: "online",
          worker: {
            id: environment.id,
            environmentID: environment.id,
            url: url.origin,
            passwordEnv: "fixture-credential-reference",
            directories: [environment.directory],
            tags: ["isolated"],
          },
        },
      })
    if (request.method() === "DELETE") {
      if (url.searchParams.get("purge") === "true") environments.splice(environments.indexOf(environment), 1)
      else Object.assign(environment, { state: "archived" })
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({ status: 400, json: { message: "Unsupported fixture operation" } })
  })
}

export async function mockMachineInspection(page: Page) {
  const state = { available: true, missingDirectory: "", checks: [] as string[], directories: [] as string[] }
  await page.route(/\/api\/location(?:\?|$)/, (route) => {
    const directory = new URL(route.request().url()).searchParams.get("location[directory]") ?? ""
    state.directories.push(directory)
    if (directory && directory === state.missingDirectory)
      return route.fulfill({
        status: 404,
        json: { _tag: "LocationNotFoundError", location: { directory }, message: `Location not found: ${directory}` },
      })
    return route.fallback()
  })
  await page.route("**/api/system", (route) => {
    state.checks.push(route.request().url())
    if (!state.available) return route.fulfill({ status: 503, json: { message: "Fixture server unavailable" } })
    return route.fulfill({
      json: {
        version: "fixture",
        runtime: "bun",
        platform: "linux arm64",
        pid: 1,
        started: 1,
        memory: 1024,
        urls: ["http://127.0.0.1:35555"],
        paths: { config: "/config", data: "/data", state: "/state", cache: "/cache", log: "/log", tmp: "/tmp" },
        database: { kind: "memory" },
      },
    })
  })
  return state
}

export async function mockHarnessOperations(page: Page, input: { output?: string } = {}) {
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
        id: state.runs.length ? `native-run-${state.runs.length + 1}` : "native-run",
        nativeID: state.runs.length ? `provider-session-${state.runs.length + 1}` : "provider-session",
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
        json: {
          run,
          events: [{ cursor: 1, kind: "text", text: input.output ?? "Native harness output" }],
          requests: state.requests,
        },
      })
    return route.fulfill({ status: 400, json: { message: "Unsupported fixture operation" } })
  })
  return {
    loseProcess: () => {
      state.runs = state.runs.map((item) => ({ ...item, state: "unknown" }))
    },
  }
}

export async function mockWorktreeOperations(page: Page, options: { diff?: string } = {}) {
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
          diff: options.diff ?? "+ agent result",
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
