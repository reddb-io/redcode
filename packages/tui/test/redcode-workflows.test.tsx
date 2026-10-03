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
  await setup.waitForFrame((frame) => frame.includes("S2 principal") && frame.includes("Add connection"))
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
  test(`/dual selects or reuses S2 and retries only S1 at ${width} columns`, async () => {
    await using state = await tmpdir()
    const location = { directory, project: { id: "project", directory, canonical: directory } }
    const discoveries: unknown[] = []
    const probes: unknown[] = []
    const generated: unknown[] = []
    const saves: unknown[] = []
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
        if (url.pathname === "/api/agent")
          return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
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
        if (url.pathname === "/api/experimental/intelligence" && request.method === "PUT") {
          const body = await request.json()
          saves.push(body)
          return json(body.settings)
        }
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
          return json({
            models: [{ id: "native-decision", name: "Native decision", endpoint: "decisions" }],
            manual: false,
          })
        }
        if (url.pathname === "/api/experimental/generate") {
          generated.push(await request.json())
          return json({
            data: {
              text: "OK",
              requests: [
                {
                  url: "http://router.local/v1/chat/completions",
                  method: "POST",
                  status: 200,
                  durationMs: 10,
                  bytes: 100,
                },
              ],
            },
          })
        }
        if (url.pathname === "/api/experimental/intelligence/probe") {
          probes.push(await request.json())
          return json({
            ok: probes.length > 1,
            endpoint: "decisions",
            message: probes.length > 1 ? "Connection checked" : "System One HTTP 502",
            requests: [
              {
                url: "http://router.local/v1/decisions",
                method: "POST",
                status: probes.length > 1 ? 200 : 502,
                durationMs: 10,
                bytes: 98,
              },
            ],
          })
        }
      },
    })
    await setup.ready
    await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-pane")))
    await setup.waitForFrame((frame) => frame.includes("Generator"))
    await setup.mockInput.typeText("/dual")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Reasoning mode"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("S2 principal · connection") && frame.includes("Work account"))
    expect(setup.captureCharFrame()).not.toContain("Keep Generator")
    expect(setup.captureCharFrame()).not.toContain("Continue with current")
    expect(setup.captureCharFrame()).toContain("Use current connection and model")
    if (width === 80) setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()
    if (width === 80) {
      await setup.waitForFrame((frame) => frame.includes("S2 principal · model") && frame.includes("Generator"))
      setup.mockInput.pressEnter()
    }
    await setup.waitForFrame((frame) => frame.includes("S1 evaluator · connection") && frame.includes("Router account"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("S1 evaluator · model") && frame.includes("Native decision"))
    expect(setup.captureCharFrame()).not.toContain("manually")
    expect(discoveries).toEqual([{ evaluator }])
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("S2 transformations") && frame.includes("Reuse S2 principal"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) => frame.includes("Test and save reasoning roles") && frame.includes("native-decision"),
    )
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("S1 evaluator connection failed") && frame.includes("HTTP 502"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Connection test results"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame(() => saves.length === 1)
    expect(generated).toHaveLength(1)
    expect(probes).toHaveLength(2)
    expect(probes).toEqual([
      { evaluator: { ...evaluator, model: "native-decision", endpoint: "decisions" } },
      { evaluator: { ...evaluator, model: "native-decision", endpoint: "decisions" } },
    ])
    expect(saves[0]).toMatchObject({
      settings: {
        principal: {
          providerID: "provider",
          id: "generator",
          connection: { type: "credential", id: "cred_generator" },
        },
        evaluator: { ...evaluator, model: "native-decision", endpoint: "decisions" },
      },
    })
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
  if (setup.captureCharFrame().includes("Use current connection and model")) setup.mockInput.pressArrow("down")
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

test("saving a Router key shows remote HTTP diagnostics and keeps an empty catalog visibly failed", async () => {
  await using state = await tmpdir()
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const account = { saved: false, checks: 0 }
  await using setup = await createAppFixture({
    state: state.path,
    fetch: (url, request) => {
      if (url.pathname === "/api/integration")
        return json({
          location,
          data: [
            {
              id: "red-router",
              name: "RedRouter",
              methods: [{ type: "key", label: "Router API key" }],
              connections: account.saved
                ? [{ type: "credential", id: "cred_router_check", label: "Router", method: "key" }]
                : [],
            },
          ],
        })
      if (url.pathname === "/api/integration/red-router/connect/key" && request.method === "POST") {
        account.saved = true
        return new Response(null, { status: 204 })
      }
      if (url.pathname === "/api/integration/red-router/check") {
        account.checks++
        return json({
          ok: false,
          message: "HTTP 200 returned an empty model catalog.",
          requests: [
            {
              url: "http://router.test/v1/models",
              method: "GET",
              status: 200,
              durationMs: 123,
              bytes: 11,
              models: 0,
            },
          ],
        })
      }
    },
  })
  const waitForStep = (step: string, predicate: (frame: string) => boolean) =>
    setup.waitForFrame(predicate).catch((cause: unknown) => {
      throw new Error(`${step}: saved=${account.saved}, checks=${account.checks}`, { cause })
    })
  await setup.ready
  await waitForStep("session ready", () => Boolean(setup.renderer.root.findDescendantById("session-pane")))
  await setup.mockInput.typeText("/connect")
  setup.mockInput.pressEnter()
  await waitForStep(
    "integration picker",
    (frame) => frame.includes("Connect an integration") && frame.includes("RedRouter"),
  )
  setup.mockInput.pressEnter()
  await waitForStep("key prompt", (frame) => frame.includes("Router API key"))
  await setup.mockInput.typeText("fixture-key")
  setup.mockInput.pressEnter()
  await waitForStep("remote report", (frame) => frame.includes("Remote API test failed"))
  expect(setup.captureCharFrame()).toContain("Credential saved.")
  expect(setup.captureCharFrame()).toContain("HTTP 200 · 123 ms · 11 bytes · 0 models")
  expect(setup.captureCharFrame()).toContain("http://router.test/v1/models")
  expect(setup.captureCharFrame()).not.toContain("fixture-key")
  setup.mockInput.pressEnter()
  await waitForStep("retry report", (frame) => account.checks === 2 && frame.includes("Remote API test failed"))
  expect(account.saved).toBe(true)
})

test("/connect switches between saved OpenRouter and RedRouter connections through their model pickers", async () => {
  await using state = await tmpdir()
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const writes: string[] = []
  const providers = [
    { id: "openrouter", integrationID: "openrouter", name: "OpenRouter" },
    { id: "red-router-main", integrationID: "red-router", name: "RedRouter" },
  ]
  const models = providers.map((provider) => ({
    id: `${provider.id}-model`,
    providerID: provider.id,
    name: `${provider.name} fixture model`,
    enabled: true,
    capabilities: { output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
  }))
  await using setup = await createAppFixture({
    state: state.path,
    fetch: (url, request) => {
      if (request.method !== "GET") writes.push(url.pathname)
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/model") return json({ location, data: models })
      if (url.pathname === "/api/provider") return json({ location, data: providers })
      if (url.pathname === "/api/integration")
        return json({
          location,
          data: providers.map((provider) => ({
            id: provider.integrationID,
            name: provider.name,
            methods: [{ type: "key", label: "Standard key" }],
            connections: [
              { type: "credential", id: `cred_${provider.id}`, method: "key", label: `${provider.name} Standard key` },
            ],
          })),
        })
    },
  })
  await setup.ready
  await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-pane")))

  await setup.mockInput.typeText("/models")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => frame.includes("OpenRouter fixture model") && frame.includes("RedRouter fixture model"),
  )
  await setup.mockInput.typeText("OpenRouter fixture model")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => frame.includes("OpenRouter fixture model") && !frame.includes("RedRouter fixture model"),
  )

  for (const name of ["RedRouter", "OpenRouter"]) {
    await setup.mockInput.typeText("/connect")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Connect an integration"))
    await setup.mockInput.typeText(name)
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Saved connections") && frame.includes(`${name} Standard key`))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes(`${name} fixture model`) && !frame.includes("Saved connections"))
    const other = name === "RedRouter" ? "OpenRouter" : "RedRouter"
    // The other provider's current model stays in the prompt until a new model is chosen.
    expect(setup.captureCharFrame().split(`${other} fixture model`)).toHaveLength(2)
    setup.mockInput.pressEnter()
    await setup.waitForFrame(
      (frame) => frame.includes(`${name} fixture model`) && !frame.includes(`${other} fixture model`),
    )
  }

  expect(writes.filter((path) => path !== "/api/session" && !path.endsWith("/model"))).toEqual([])
})
