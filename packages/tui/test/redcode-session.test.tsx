import { ScrollBoxRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json, worktree } from "./fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }

test("a resumed prototype keeps its review address visible without launching another browser", async () => {
  await using state = await tmpdir()
  const session = {
    id: "ses_profile_design",
    projectID: "project",
    title: "Profile design",
    agent: "design",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
  const review = "http://localhost/review/profile"
  const requests: string[] = []
  await using setup = await createAppFixture({
    state: state.path,
    width: 120,
    args: { sessionID: session.id },
    config: { animations: false, session: { sidebar: "hide" } },
    fetch: (url) => {
      if (url.pathname.startsWith("/design/")) requests.push(url.pathname)
      if (url.pathname === `/design/session/${session.id}/link`) return json({ url: review })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({
          data: [
            {
              id: "msg_preview",
              type: "assistant",
              agent: "design",
              model: { providerID: "fixture", id: "model" },
              time: { created: 1, completed: 2 },
              content: [
                {
                  type: "tool",
                  id: "call_preview",
                  name: "design_preview",
                  time: { created: 1, completed: 2 },
                  state: {
                    status: "completed",
                    input: { id: "design_profile", name: "Profile" },
                    content: [{ type: "text", text: "Published profile" }],
                    metadata: { designID: "design_profile", revision: "rev_profile" },
                  },
                },
              ],
            },
          ],
          cursor: {},
        })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes(`Prototype review: ${review}`))
  for (let index = 0; index < 3; index++) await setup.renderOnce()
  expect(requests).toEqual([`/design/session/${session.id}/link`])
})

test("session location stays visible without the sidebar while Build runs and moves to its worktree", async () => {
  await using state = await tmpdir()
  const destination = "/tmp/opencode/.red/worktrees/redcode-fixture/packages/tui"
  const checkout = "/tmp/opencode/.red/worktrees/redcode-fixture"
  const created: string[] = []
  await using setup = await createAppFixture({
    state: state.path,
    width: 80,
    height: 30,
    config: { animations: false, session: { sidebar: "hide" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/session" && request.method === "POST")
        created.push(((await request.clone().json()) as { id: string }).id)
      if (url.searchParams.get("location[directory]") !== destination) return
      if (url.pathname === "/api/location")
        return json({ directory: destination, project: { id: "proj_test", directory: checkout, canonical: worktree } })
      if (url.pathname === "/api/vcs")
        return json({
          location: { directory: destination },
          data: { branch: { current: "redcode-fixture", default: "main" } },
        })
    },
  })
  await setup.ready
  await setup.waitForFrame(
    (frame) => frame.includes(directory) && frame.includes("primary checkout") && frame.includes("⑂ main"),
  )
  expect(created).toHaveLength(1)
  const sessionID = created[0]!
  expect(setup.renderer.root.findDescendantById("session.location")).toBeDefined()
  expect(setup.captureCharFrame()).not.toContain("Context")

  setup.events.emit({
    id: "evt_build_started",
    created: 1,
    type: "session.execution.started",
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID },
  })
  await setup.waitForFrame(
    (frame) => frame.includes("interrupt") && frame.includes("primary checkout") && frame.includes("⑂ main"),
  )

  setup.events.emit({
    id: "evt_worktree_moved",
    created: 2,
    type: "session.moved",
    durable: { aggregateID: sessionID, seq: 2, version: 1 },
    data: { sessionID, location: { directory: destination }, projectID: "proj_test", subpath: "packages/tui" },
  })
  await setup.waitForFrame(
    (frame) =>
      frame.includes(destination) &&
      frame.includes(".red/worktrees/redcode-fixture") &&
      frame.includes("⑂ redcode-fixture"),
  )
  expect(setup.captureCharFrame()).toContain("/tmp/opencode")
})

test.each([80, 160])(
  "Redcode opens blank sessions with Context and the activity drawer at %i columns",
  async (width) => {
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
        if (url.pathname === "/api/integration")
          return json({
            location,
            data: [
              {
                id: "provider",
                name: "Provider",
                methods: [],
                connections: [{ type: "env", name: "FIXTURE_PROVIDER_KEY" }],
              },
            ],
          })
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
          created.length === before + 1 &&
          frame.includes("Build") &&
          frame.includes("Model") &&
          !frame.includes(command),
      )
    }
    expect(new Set(created).size).toBe(4)
    // No deletion or prompt submission is allowed while creating/clearing sessions.
    expect(writes).toEqual(Array(4).fill("/api/session"))
    expect(setup.captureCharFrame()).not.toContain("█")
    if (width === 80) setup.mockInput.pressKey("F6")
    await setup.waitForFrame((frame) => frame.includes("Context"))
    await setup.waitForFrame((frame) => frame.includes("Preserve Redcode work") && /Waiting\s+for reviewer/.test(frame))
    expect(setup.captureCharFrame()).not.toContain("Old completed task")
    expect(setup.captureCharFrame()).toContain("Todo")
    expect(setup.captureCharFrame()).toContain("[•] Preserve Redcode work")
    expect(setup.captureCharFrame()).toContain("[!] External verification")
    await setup.waitForFrame(
      (frame) =>
        frame.includes("typescript") && frame.includes("redcode.ts") && frame.includes("+12") && frame.includes("-3"),
    )
    expect(setup.captureCharFrame()).not.toContain("▼ LSP")
    expect(setup.captureCharFrame()).not.toContain("▼ Modified Files")
    expect(setup.captureCharFrame().indexOf("Modified Files")).toBeLessThan(setup.captureCharFrame().indexOf("LSP"))
    await setup.mockInput.typeText("/workers")
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) => frame.includes("Subagents") && frame.includes("Workers") && frame.includes("No workers connected."),
    )
    setup.mockInput.pressEscape()
    await setup.mockInput.typeText("/subagents")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("No active subagents"))
  },
)

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

test("/monitors opens the Monitors drawer to inspect evidence and stop observation via V2", async () => {
  await using state = await tmpdir()
  const cancelled: string[] = []
  const monitor = {
    id: "monitor_fixture",
    sessionID: "ses_fixture",
    command: "watch-build",
    workdir: directory,
    options: { mode: "once", deadline_ms: 600_000 },
    status: "running",
    created: Date.now(),
    updated: Date.now(),
    attempts: 2,
    delivery: "pending",
    evidence: { exit: 0, output: "Build started\nBuild evidence visible", truncated: false },
  }
  await using setup = await createAppFixture({
    state: state.path,
    fetch: (url, request) => {
      if (/^\/api\/session\/[^/]+\/monitor$/.test(url.pathname)) return json({ data: [monitor] })
      if (/\/monitor\/monitor_fixture\/cancel$/.test(url.pathname) && request.method === "POST") {
        cancelled.push(url.pathname)
        monitor.status = "cancelled"
        monitor.delivery = "suppressed"
        return json({ data: monitor })
      }
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => !frame.includes("Opening session") && frame.includes("1 monitor"))
  await setup.mockInput.typeText("/monitors")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Monitors") &&
      frame.includes("watch-build") &&
      frame.includes("2 checks · Build evidence visible"),
  )
  expect(setup.captureCharFrame()).not.toContain("Build started")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Build started"))
  setup.mockInput.pressKey("d", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Stop observing watch-build?"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => cancelled.length === 1 && frame.includes("cancelled") && frame.includes("not delivered"),
  )
  expect(cancelled[0]).toMatch(/^\/api\/session\/ses[^/]+\/monitor\/monitor_fixture\/cancel$/)
})

test("the Subagents sidebar steers and interrupts the selected child through V2", async () => {
  await using state = await tmpdir()
  const sessions = [
    { id: "ses_parent", title: "Parent task" },
    {
      id: "ses_child",
      parentID: "ses_parent",
      title: "Inspect sidebar (@explore subagent)",
      model: { providerID: "provider", id: "child-model", variant: "high" },
    },
  ].map((session) => ({
    ...session,
    projectID: "project",
    location: { directory },
    time: { created: 1, updated: 1 },
  }))
  const writes: Array<{ path: string; body: unknown }> = []
  await using setup = await createAppFixture({
    state: state.path,
    width: 160,
    height: 40,
    args: { sessionID: "ses_parent" },
    config: { animations: false, tabs: { mode: "off" }, keybinds: { "sidebar.tab.next": "f7" } },
    fetch: async (url, request) => {
      if (request.method === "POST") {
        const body = await request.clone().text()
        writes.push({ path: url.pathname, body: body ? JSON.parse(body) : undefined })
      }
      if (url.pathname === "/api/session") return json({ data: sessions, cursor: {} })
      if (url.pathname === "/api/session/active") return json({ data: { ses_child: { type: "running" } } })
      const session = sessions.find((session) => url.pathname === `/api/session/${session.id}`)
      if (session) return json({ data: session })
      if (url.pathname === "/api/session/ses_child/prompt")
        return json({
          data: {
            id: "msg_hint",
            sessionID: "ses_child",
            type: "user",
            time: { created: 2 },
            payload: { text: "Keep the original palette" },
            delivery: "steer",
          },
        })
      if (url.pathname === "/api/session/ses_child/interrupt") return new Response(null, { status: 204 })
      if (/^\/api\/session\/ses_(parent|child)\/message$/.test(url.pathname))
        return json({
          data: url.pathname.includes("ses_child")
            ? [{ id: "msg_child", type: "user", text: "Child investigation", time: { created: 1 } }]
            : [],
          cursor: {},
        })
      if (/^\/api\/session\/ses_(parent|child)\/(inbox|permission|todo)$/.test(url.pathname)) return json({ data: [] })
    },
  })
  await setup.ready
  await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-sidebar")))
  await setup.mockInput.typeText("/subagents")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("child-model (high)") && frame.includes("steer"))
  setup.mockInput.pressEscape()
  await setup.mockInput.typeText("/context")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("0 tokens") && !frame.includes("child-model (high)"))
  await setup.mockInput.typeText("/subagents")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("child-model (high)") && frame.includes("steer"))

  const click = async (id: string) => {
    const node = setup.renderer.root.findDescendantById(id)
    if (!node) throw new Error(`Missing action ${id}`)
    await setup.mockMouse.click(node.x, node.y)
  }
  await click("subagent-steer-ses_child")
  await setup.waitForFrame((frame) => frame.includes("Steer subagent"))
  await setup.mockInput.typeText("Keep the original palette")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Hint sent to the subagent"))
  expect(writes).toEqual([
    { path: "/api/session/ses_child/prompt", body: { text: "Keep the original palette", delivery: "steer" } },
  ])
  await click("subagent-kill-ses_child")
  await setup.waitForFrame((frame) => frame.includes("Kill subagent"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Kill subagent"))
  expect(writes).toHaveLength(1)
  await click("subagent-kill-ses_child")
  await setup.waitForFrame((frame) => frame.includes("Kill subagent"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => writes.length === 2)
  expect(writes[1]?.path).toBe("/api/session/ses_child/interrupt")
  await click("subagent-open-ses_child")
  await setup.waitForFrame((frame) => frame.includes("Child investigation"))
  expect(writes).toHaveLength(2)
})

test.each([
  { columns: 80, expected: 36 },
  { columns: 160, expected: 40 },
  { columns: 240, expected: 44 },
])("Context sidebar retains its Redcode width after reopening at $columns columns", async ({ columns, expected }) => {
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
    await setup.mockInput.typeText("/workers")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("No workers connected."))
  }
  {
    await using setup = await createAppFixture({ state: state.path, width: columns, height: 40, config })
    await setup.ready
    await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-pane")))
    if (columns === 80) setup.mockInput.pressKey("F6")
    await setup.waitForFrame(() => setup.renderer.root.findDescendantById("session-sidebar")?.width === expected + 4)
  }
})

test.each([80, 160])("large MCP catalogs and tools scroll inside their panels at %i columns", async (width) => {
  await using state = await tmpdir()
  const servers = Array.from({ length: 40 }, (_, index) => ({
    name: `server-${String(index).padStart(2, "0")}`,
    status: { status: "connected" },
  }))
  await using setup = await createAppFixture({
    state: state.path,
    width,
    height: 24,
    config: { animations: false, tabs: { mode: "off" } },
    fetch: (url) => {
      if (url.pathname === "/api/integration")
        return json({
          location,
          data: [
            {
              id: "provider",
              name: "Provider",
              methods: [],
              connections: [{ type: "env", name: "FIXTURE_PROVIDER_KEY" }],
            },
          ],
        })
      if (url.pathname === "/api/mcp") return json({ location, data: servers })
      if (url.pathname === "/api/mcp/tool")
        return json({
          location,
          data: Array.from({ length: 40 }, (_, index) => ({ server: "server-00", name: `tool-${index}` })),
        })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => !frame.includes("Opening session"))
  if (width === 160)
    await setup.waitForFrame(() => setup.renderer.root.findDescendantById("sidebar-mcps-scroll")?.height === 5)
  const sidebar = setup.renderer.root.findDescendantById("sidebar-mcps-scroll")
  if (width === 160) expect(sidebar).toBeInstanceOf(ScrollBoxRenderable)
  if (sidebar instanceof ScrollBoxRenderable) {
    expect(sidebar.height).toBe(5)
    expect(sidebar.scrollHeight).toBeGreaterThan(5)
    sidebar.scrollTo(sidebar.scrollHeight)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("server-39")
  }
  setup.mockInput.pressKey("p", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Commands"))
  await setup.mockInput.typeText("Open MCPs drawer")
  await setup.waitForFrame((frame) => frame.includes("Open MCPs drawer"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => setup.renderer.root.findDescendantById("composer-mcps-scroll")?.height === 5)
  const scroll = setup.renderer.root.findDescendantById("composer-mcps-scroll")
  if (!(scroll instanceof ScrollBoxRenderable)) throw new Error("Missing MCP drawer scroll")
  expect(scroll.height).toBe(5)
  const bottom = scroll.y + scroll.height
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("tool-0"))
  expect(scroll.height).toBe(5)
  expect(scroll.y + scroll.height).toBe(bottom)
  for (let page = 0; page < 6; page++) {
    setup.mockInput.pressKey("\u001b[6~")
    await setup.renderOnce()
  }
  await setup
    .waitForFrame((frame) => frame.includes("tool-30"))
    .catch((cause: unknown) => {
      throw new Error(`Paging MCP tools: height=${scroll.height}, top=${scroll.scrollTop}`, { cause })
    })
  expect(setup.captureCharFrame()).toContain("reload config")
  setup.mockInput.pressEnter()
  for (let index = 0; index < 39; index++) {
    setup.mockInput.pressKey("ARROW_DOWN")
    await setup.waitFor(() =>
      Boolean(
        setup.renderer.root.findDescendantById(`composer-mcp-controls-server-${String(index + 1).padStart(2, "0")}`),
      ),
    )
    await setup.renderOnce()
  }
  await setup
    .waitForFrame((frame) => frame.includes("server-39"))
    .catch((cause: unknown) => {
      throw new Error(`Last MCP server: height=${scroll.height}, top=${scroll.scrollTop}`, { cause })
    })
  expect(scroll.height).toBe(5)
})
