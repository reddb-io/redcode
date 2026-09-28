import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }

test.each([80, 160])("Redcode opens real blank sessions and preserves its sidebar at %i columns", async (width) => {
  await using state = await tmpdir()
  const created: string[] = []
  const writes: string[] = []
  await using setup = await createAppFixture({
    state: state.path,
    width,
    height: 40,
    config: {
      animations: false,
      tabs: { mode: "off" },
      keybinds: { "session.sidebar.toggle": "f6", "sidebar.tab.next": "f7" },
    },
    fetch: async (url, request) => {
      if (request.method !== "GET") writes.push(url.pathname)
      if (url.pathname === "/api/session" && request.method === "POST") {
        const input = (await request.clone().json()) as { id: string }
        created.push(input.id)
      }
      if (/^\/api\/session\/[^/]+\/todo$/.test(url.pathname))
        return json({
          data: [
            { id: "task_pending", content: "Preserve Redcode work", status: "in_progress", priority: "high" },
            {
              id: "task_blocked",
              content: "External verification",
              status: "blocked",
              priority: "medium",
              reason: "Waiting for reviewer",
            },
            { id: "task_old", content: "Old completed task", status: "completed", priority: "low", closedAt: 1 },
          ],
        })
      if (/^\/api\/session\/[^/]+\/diff$/.test(url.pathname)) {
        expect(url.searchParams.get("scope")).toBe("session")
        return json({ data: [{ file: "redcode.ts", patch: "", additions: 12, deletions: 3, status: "modified" }] })
      }
      if (url.pathname === "/api/lsp") {
        expect(url.searchParams.get("location[directory]")).toBe(directory)
        return json({ location, data: [{ id: "typescript", root: ".", status: "connected" }] })
      }
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: ["build", "plan", "design", "question"].map((id) => ({
            id,
            mode: "primary",
            hidden: false,
            permissions: [],
          })),
        })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            {
              id: "model",
              providerID: "provider",
              name: "Model",
              enabled: true,
              capabilities: { output: ["text"] },
              variants: [],
              time: { released: 0 },
              cost: [],
            },
          ],
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/redskilled")
        return json({
          location,
          data: {
            lifecycle: "unavailable",
            consent: "unknown",
            scope: "project",
            native: true,
            error: "Fixture worker unavailable",
          },
        })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Build") && frame.includes("Model"))
  expect(created).toHaveLength(1)
  for (const command of ["/new", "/clear", "/new"]) {
    const before = created.length
    await setup.mockInput.typeText(command)
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) =>
        created.length === before + 1 && frame.includes("Build") && frame.includes("Model") && !frame.includes(command),
    )
  }
  expect(new Set(created).size).toBe(4)
  // No deletion or prompt submission is allowed while creating/clearing sessions.
  expect(writes).toEqual(Array(4).fill("/api/session"))
  expect(setup.captureCharFrame()).not.toContain("█")
  if (width === 80) setup.mockInput.pressKey("F6")
  await setup.waitForFrame(
    (frame) => frame.includes("Context") && frame.includes("Workers") && frame.includes("Subagents"),
  )
  await setup.waitForFrame((frame) => frame.includes("Preserve Redcode work") && frame.includes("Waiting for reviewer"))
  expect(setup.captureCharFrame()).not.toContain("Old completed task")
  await setup.waitForFrame(
    (frame) =>
      frame.includes("typescript") && frame.includes("redcode.ts") && frame.includes("+12") && frame.includes("-3"),
  )
  setup.mockInput.pressKey("F7")
  await setup.waitForFrame((frame) => frame.includes("Worker status is unavailable."))
  setup.mockInput.pressKey("F7")
  await setup.waitForFrame((frame) => frame.includes("No subagents in this session."))
})

test("--continue with no prior session opens a blank session", async () => {
  await using state = await tmpdir()
  let created = 0
  await using setup = await createAppFixture({
    state: state.path,
    args: { continue: true },
    fetch: (url, request) => {
      if (url.pathname === "/api/session" && request.method === "POST") created++
      return undefined
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => created === 1 && !frame.includes("Opening session"))
  expect(created).toBe(1)
})

test.each(["session", "continue"] as const)(
  "%s resumes existing history without creating a blank session",
  async (mode) => {
    await using state = await tmpdir()
    const session = {
      id: "ses_existing",
      projectID: "project",
      title: "Existing Redcode session",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
    }
    const writes: string[] = []
    await using setup = await createAppFixture({
      state: state.path,
      args: mode === "session" ? { sessionID: session.id } : { continue: true },
      fetch: (url, request) => {
        if (request.method !== "GET") writes.push(url.pathname)
        if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
        if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
        if (url.pathname === `/api/session/${session.id}/message`)
          return json({
            data: [{ id: "msg_existing", type: "user", text: "Previous Redcode conversation", time: { created: 1 } }],
            cursor: {},
          })
        if ([`/api/session/${session.id}/inbox`, `/api/session/${session.id}/permission`].includes(url.pathname))
          return json({ data: [] })
      },
    })
    await setup.ready
    await setup.waitForFrame((frame) => frame.includes("Previous Redcode conversation"))
    expect(writes).toEqual([])
  },
)

test("failed blank-session creation can be retried from the keyboard", async () => {
  await using state = await tmpdir()
  let attempts = 0
  await using setup = await createAppFixture({
    state: state.path,
    fetch: (url, request) => {
      if (url.pathname !== "/api/session" || request.method !== "POST") return
      attempts++
      if (attempts === 1) return json({ message: "Fixture creation failed" }, { status: 500 })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Press enter or click to retry"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => attempts === 2 && !frame.includes("Opening session") && !frame.includes("Press enter or click to retry"),
  )
  expect(attempts).toBe(2)
})

test("/monitors inspects evidence and stops observation through the V2 session API", async () => {
  await using state = await tmpdir()
  const cancelled: string[] = []
  const monitor = {
    id: "monitor_fixture",
    sessionID: "ses_fixture",
    command: "watch-build",
    workdir: directory,
    options: { mode: "once" },
    status: "running",
    created: 1,
    updated: 1,
    attempts: 2,
    delivery: "observed",
    evidence: { exit: 0, output: "Build evidence visible", truncated: false },
  }
  await using setup = await createAppFixture({
    state: state.path,
    fetch: (url, request) => {
      if (/^\/api\/session\/[^/]+\/monitor$/.test(url.pathname)) return json({ data: [monitor] })
      if (/\/monitor\/monitor_fixture$/.test(url.pathname)) return json({ data: monitor })
      if (/\/monitor\/monitor_fixture\/cancel$/.test(url.pathname) && request.method === "POST") {
        cancelled.push(url.pathname)
        monitor.status = "cancelled"
        return json({ data: monitor })
      }
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => !frame.includes("Opening session") && frame.includes("ctrl+p commands"))
  await setup.mockInput.typeText("/monitors")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Session monitors") && frame.includes("watch-build"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("View last result") && frame.includes("Stop monitoring"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Build evidence visible"))
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => cancelled.length === 1 && frame.includes("cancelled: watch-build") && !frame.includes("Stop monitoring"),
  )
  expect(cancelled[0]).toMatch(/^\/api\/session\/ses[^/]+\/monitor\/monitor_fixture\/cancel$/)
})

test.each([
  { columns: 80, expected: 36 },
  { columns: 160, expected: 40 },
  { columns: 240, expected: 44 },
])(
  "sidebar retains its Redcode width and selected tab after reopening at $columns columns",
  async ({ columns, expected }) => {
    await using state = await tmpdir()
    const config = {
      animations: false,
      tabs: { mode: "off" as const },
      keybinds: {
        "session.sidebar.toggle": "f6",
        "session.sidebar.tab.cycle": "f7",
        "session.sidebar.width.increase": "f8",
        "session.sidebar.width.decrease": "f9",
      },
    }
    {
      await using setup = await createAppFixture({ state: state.path, width: columns, height: 40, config })
      await setup.ready
      await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-pane")))
      if (columns === 80) setup.mockInput.pressKey("F6")
      await setup.waitForFrame(() => setup.renderer.root.findDescendantById("session-sidebar")?.width === expected)
      setup.mockInput.pressKey("F8")
      await setup.waitForFrame(() => setup.renderer.root.findDescendantById("session-sidebar")?.width === expected + 4)
      setup.mockInput.pressKey("F9")
      await setup.waitForFrame(() => setup.renderer.root.findDescendantById("session-sidebar")?.width === expected)
      setup.mockInput.pressKey("F8")
      await setup.waitForFrame(() => setup.renderer.root.findDescendantById("session-sidebar")?.width === expected + 4)
      setup.mockInput.pressKey("F7")
      await setup.waitForFrame((frame) => frame.includes("Worker status is unavailable."))
      setup.mockInput.pressKey("F7")
      await setup.waitForFrame((frame) => frame.includes("No subagents in this session."))
    }
    {
      await using setup = await createAppFixture({ state: state.path, width: columns, height: 40, config })
      await setup.ready
      await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-pane")))
      if (columns === 80) setup.mockInput.pressKey("F6")
      await setup.waitForFrame((frame) => frame.includes("No subagents in this session."))
      expect(setup.renderer.root.findDescendantById("session-sidebar")?.width).toBe(expected + 4)
    }
  },
)
