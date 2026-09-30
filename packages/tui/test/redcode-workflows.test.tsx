import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

test("historical thinking and timestamp commands change display preferences", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({ state: state.path })
  await setup.ready
  await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-pane")))
  for (const [command, field, expected] of [
    ["/thinking", "thinking", "show"],
    ["/toggle-thinking", "thinking", "hide"],
    ["/timestamps", "timestamps", "show"],
    ["/toggle-timestamps", "timestamps", "hide"],
  ] as const) {
    await setup.mockInput.typeText(command)
    setup.mockInput.pressEnter()
    await setup.waitForFrame(() => setup.config().session?.[field] === expected)
    expect(setup.captureCharFrame()).not.toContain("No variants available")
  }
})

test("Redcode setup, intelligence and Design commands reach their production UI without submitting a prompt", async () => {
  await using state = await tmpdir()
  const writes: string[] = []
  const controls: string[] = []
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  await using setup = await createAppFixture({
    state: state.path,
    fetch: async (url, request) => {
      if (request.method !== "GET") writes.push(url.pathname)
      if (url.pathname.endsWith("/goal/control")) {
        const input = (await request.json()) as { action: string }
        controls.push(input.action)
        return json({ data: null })
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
      if (url.pathname === "/api/experimental/design/conversations") return json([])
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Build") && frame.includes("Model"))
  await setup.mockInput.typeText("/setup")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Reasoning mode"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("S2 principal") && frame.includes("Connect another provider"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("S2 principal"))
  expect(writes).toEqual(["/api/session"])

  await setup.mockInput.typeText("/intelligence")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("S2 default:") && frame.includes("S2 current:"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("S2 default:"))
  await setup.mockInput.typeText("/design-open")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Resume Design conversation"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Resume Design conversation"))
  await setup.mockInput.typeText("/design")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Design") && frame.includes("Model"))
  expect(writes).toEqual(["/api/session"])
  for (const action of ["pause", "resume", "drop"]) {
    await setup.mockInput.typeText(`/goal-${action}`)
    setup.mockInput.pressEnter()
    await setup.waitForFrame(() => controls.includes(action))
  }
  await setup.mockInput.typeText("/goal-budget")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Goal budget"))
  await setup.mockInput.typeText("25")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => controls.includes("budget"))
  expect(controls).toEqual(["pause", "resume", "drop", "budget"])
})

test("/hooks requires confirmation before trusting or importing project commands", async () => {
  await using state = await tmpdir()
  const writes: string[] = []
  const trust = { trusted: false, fingerprint: "0123456789abcdef" }
  await using setup = await createAppFixture({
    state: state.path,
    fetch: (url, request) => {
      if (!url.pathname.startsWith("/api/hook")) return
      expect(url.searchParams.get("location[directory]")).toBe(directory)
      if (request.method !== "GET") writes.push(`${request.method} ${url.pathname}`)
      if (url.pathname === "/api/hook/trust") {
        trust.trusted = request.method === "POST"
        return json({ location: { directory }, data: trust })
      }
      if (url.pathname === "/api/hook/import/claude")
        return json({ location: { directory }, data: { imported: 1, target: "redcode.json", restart_required: true } })
      return json({ location: { directory }, data: { trust, definitions: [] } })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  await setup.mockInput.typeText("/hooks")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Approval required"))
  await setup.mockInput.typeText("t")
  await setup.waitForFrame((frame) => frame.includes("Enter to confirm"))
  expect(writes).toEqual([])
  setup.mockInput.pressKey("ESCAPE")
  await setup.waitForFrame((frame) => frame.includes("t trust"))
  expect(writes).toEqual([])
  await setup.mockInput.typeText("t")
  await setup.waitForFrame((frame) => frame.includes("Enter to confirm"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Trusted") && !frame.includes("Applying"))
  expect(writes).toEqual(["POST /api/hook/trust"])
  await setup.mockInput.typeText("i")
  await setup.waitForFrame((frame) => frame.includes("Import Claude hooks"))
  expect(writes).toHaveLength(1)
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Imported 1 hooks"))
  expect(writes).toEqual(["POST /api/hook/trust", "POST /api/hook/import/claude"])
})

for (const width of [80, 140]) {
  test(`setup always chooses a connection then a catalog model for S2 and S1 at ${width} columns`, async () => {
    await using state = await tmpdir()
    const location = { directory, project: { id: "project", directory, canonical: directory } }
    const discoveries: unknown[] = []
    const evaluator = {
      transport: "red-router",
      baseURL: "http://router.local/v1",
      model: "unlisted-preset",
      credentialID: "cred_router",
    }
    await using setup = await createAppFixture({
      state: state.path,
      width,
      fetch: async (url, request) => {
        if (url.pathname === "/api/model")
          return json({
            location,
            data: [
              {
                id: "generator",
                providerID: "provider",
                name: "Generator",
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
                connections: [{ type: "credential", id: "cred_generator", label: "Work account", method: "key" }],
              },
            ],
          })
        if (url.pathname === "/api/experimental/intelligence")
          return json({
            settings: {
              enabled: true,
              reasoning: "dual",
              onboarding: "completed",
              principal: { providerID: "provider", id: "generator" },
              evaluator,
            },
            environment: "",
            effective: { reasoning: "dual", source: "config" },
            evaluators: [{ name: "Router account", configured: true, evaluator }],
          })
        if (url.pathname === "/api/experimental/intelligence/models") {
          discoveries.push(await request.json())
          return json({ models: [{ id: "native-decision", name: "Native decision" }], manual: false })
        }
      },
    })
    await setup.ready
    await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-pane")))
    await setup.mockInput.typeText("/setup")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Reasoning mode"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("S2 principal · connection") && frame.includes("Work account"))
    expect(setup.captureCharFrame()).not.toContain("Keep Generator")
    expect(setup.captureCharFrame()).not.toContain("Continue with current")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("S2 principal · model") && frame.includes("Generator"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("S1 evaluator · connection") && frame.includes("Router account"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("S1 evaluator · model") && frame.includes("Native decision"))
    expect(setup.captureCharFrame()).not.toContain("unlisted-preset")
    expect(setup.captureCharFrame()).not.toContain("manually")
    expect(discoveries).toEqual([{ evaluator }])
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("S2 transformations") && frame.includes("Reuse S2 principal"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) => frame.includes("Test and save reasoning roles") && frame.includes("native-decision"),
    )
    setup.mockInput.pressEscape()
  })
}

test("a connected router remains selectable before its first catalog loads", async () => {
  await using state = await tmpdir()
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const catalog = { ready: false }
  const model = (providerID: string, id: string, name: string) => ({
    id,
    providerID,
    name,
    enabled: true,
    capabilities: { output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
  })
  await using setup = await createAppFixture({
    state: state.path,
    fetch: async (url) => {
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            model("opencode", "minimax", "Minimax"),
            ...(catalog.ready ? [model("red-router", "router/generator", "Router generator")] : []),
          ],
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "opencode", name: "Zen" }] })
      if (url.pathname === "/api/integration")
        return json({
          location,
          data: [
            {
              id: "red-router",
              name: "RedRouter",
              methods: [],
              connections: [{ type: "credential", id: "cred_router", label: "Router account", method: "key" }],
            },
          ],
        })
      if (url.pathname === "/api/experimental/intelligence")
        return json({
          settings: { enabled: true, reasoning: "single", principal: { providerID: "opencode", id: "minimax" } },
          effective: { reasoning: "single", source: "config" },
          environment: "",
          evaluators: [],
        })
    },
  })
  await setup.ready
  await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-pane")))
  await setup.mockInput.typeText("/setup")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Reasoning mode"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("S2 principal · connection") && frame.includes("Router account"))
  catalog.ready = true
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("S2 principal · model") && frame.includes("Router generator"))
  expect(setup.captureCharFrame()).not.toContain("Connect an integration")
  setup.mockInput.pressEscape()
})

test("an empty S1 catalog offers refresh and another connection instead of model text entry", async () => {
  await using state = await tmpdir()
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const evaluator = {
    transport: "red-router",
    baseURL: "http://router.local/v1",
    model: "unlisted-preset",
    credentialID: "cred_router",
  }
  const discoveries: unknown[] = []
  await using setup = await createAppFixture({
    state: state.path,
    fetch: async (url, request) => {
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            {
              id: "generator",
              providerID: "provider",
              name: "Generator",
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
              connections: [{ type: "credential", id: "cred_generator", label: "Work account", method: "key" }],
            },
          ],
        })
      if (url.pathname === "/api/experimental/intelligence")
        return json({
          settings: { enabled: true, reasoning: "dual", onboarding: "completed" },
          environment: "",
          effective: { reasoning: "dual", source: "config" },
          evaluators: [{ name: "Router account", configured: false, evaluator }],
        })
      if (url.pathname === "/api/experimental/intelligence/models") {
        discoveries.push(await request.json())
        return json({
          models: discoveries.length === 1 ? [] : [{ id: "native-decision", name: "Native decision" }],
          manual: false,
        })
      }
    },
  })
  await setup.ready
  await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-pane")))
  await setup.mockInput.typeText("/setup")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Reasoning mode"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("S2 principal · connection"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("S2 principal · model"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("S1 evaluator · connection"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("No S1 models available") &&
      frame.includes("Refresh model list") &&
      frame.includes("Choose another connection"),
  )
  expect(setup.captureCharFrame()).not.toContain("S1 model ID")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("S1 evaluator · model") && frame.includes("Native decision"))
  expect(discoveries).toEqual([{ evaluator }, { evaluator }])
  setup.mockInput.pressEscape()
})
