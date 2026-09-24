/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, onMount } from "solid-js"
import { createDialogSetupState, DialogSetup } from "../../src/component/dialog-setup"
import { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import { ClipboardProvider } from "../../src/context/clipboard"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { Toast, ToastProvider } from "../../src/ui/toast"
import { mount, wait, json } from "../cli/cmd/tui/sync-fixture"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

function Dialogs(props: { resume?: Parameters<typeof createDialogSetupState>[0] } = {}) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  function Open() {
    const dialog = useDialog()
    const state = createDialogSetupState(props.resume)
    onMount(() => dialog.replace(() => <DialogSetup state={state} onModelSelected={() => {}} />))
    return null
  }
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={config}>
        <ThemeProvider mode="dark">
          <ClipboardProvider>
            <ToastProvider>
              <DialogProvider>
                <Open />
              </DialogProvider>
              <Toast />
            </ToastProvider>
          </ClipboardProvider>
        </ThemeProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

const provider = {
  id: "mock",
  name: "Mock Provider",
  env: [],
  options: {},
  source: "config",
  models: {
    model: {
      id: "model",
      providerID: "mock",
      name: "Mock Model",
      capabilities: { protocol: "language", tools: true, input: ["text"], output: ["text"] },
      limit: { context: 1000, output: 100 },
      cost: {},
    },
    combo: {
      id: "combo",
      providerID: "mock",
      name: "Balanced Combo",
      capabilities: { protocol: "language", tools: true, input: ["text"], output: ["text"] },
      limit: { context: 1000, output: 100 },
      cost: {},
    },
  },
}

const otherProvider = {
  ...provider,
  id: "other",
  name: "Other Provider",
  models: {
    other: {
      ...provider.models.model,
      id: "other",
      providerID: "other",
      name: "Other Model",
    },
  },
}

const intelligence = {
  settings: { enabled: false, onboarding: "pending" } as Intelligence.Settings,
  environment: "/global",
  evaluators: [
    {
      name: "Cloudflare AI Gateway",
      configured: true,
      evaluator: {
        transport: "cloudflare-ai-gateway",
        baseURL: "https://api.cloudflare.com/client/v4",
        model: "typesafe/jev",
      },
    },
    {
      name: "OpenCode Zen — Jev Free (recommended)",
      configured: false,
      evaluator: {
        transport: "opencode-zen",
        baseURL: "https://opencode.ai/zen/v1",
        model: "jev-1.13-free",
      },
    },
    {
      name: "OpenRouter",
      configured: false,
      evaluator: {
        transport: "openrouter",
        baseURL: "https://openrouter.ai/api/alpha",
        model: "typesafe/jev-1.13",
      },
    },
    {
      name: "Vercel AI Gateway",
      configured: false,
      evaluator: {
        transport: "vercel",
        baseURL: "https://ai-gateway.vercel.sh/v4/ai",
        model: "typesafe-ai/jev",
      },
    },
  ] satisfies Intelligence.EvaluatorOption[],
  effective: { reasoning: "single", source: "default" },
}

test("global setup selects System Two models and offers provider connection in the same flow", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json(intelligence)
      if (url.pathname === "/config/providers")
        return json({ providers: [provider, otherProvider], default: { mock: "model", other: "other" } })
    },
    tmp.path,
    () => <Dialogs resume={{ settings: intelligence.settings, step: "principal", reasoning: "dual" }} />,
    { height: 40 },
  )
  try {
    await ready(setup.app, "Balanced Combo")
    const principal = setup.app.captureCharFrame()
    expect(principal).toContain("2/3 · S2 principal · Mock Provider")
    expect(principal).toContain("Providers")
    expect(principal).toContain("Other Provider")
    expect(principal).toContain("Connect another provider…")
    expect(principal).toContain("Mock Provider models")
    expect(principal).toContain("Mock Model")
    expect(principal).not.toContain("Other Model")

    // The cursor starts on the first model, below the Providers section.
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("2/3 · S2 transformations"))
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        !setup.app.renderer.currentFocusedRenderable.isDestroyed,
    )
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("3/3 · S1 connection"))
    const evaluators = setup.app.captureCharFrame()
    expect(evaluators).toContain("Cloudflare AI Gateway")
    expect(evaluators).toContain("Configured connection")
    expect(evaluators).toContain("OpenRouter")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("global setup can open provider connection when no generative model is connected", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await mount(
    (url) => (url.pathname === "/api/intelligence" ? json(intelligence) : undefined),
    tmp.path,
    () => <Dialogs resume={{ settings: intelligence.settings, step: "principal", reasoning: "dual" }} />,
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("S2 principal"))
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        !setup.app.renderer.currentFocusedRenderable.isDestroyed,
    )
    await ready(setup.app, "Connect another provider…")
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Connect a provider"))
  } finally {
    setup.app.renderer.destroy()
  }
})

test("global setup can reuse an established provider connection without authenticating again", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json(intelligence)
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
      if (url.pathname === "/provider") {
        return json({
          all: [{ id: "mock", name: "Mock Provider", env: [] }],
          default: { mock: "model" },
          connected: ["mock"],
        })
      }
    },
    tmp.path,
    () => <Dialogs resume={{ settings: intelligence.settings, step: "principal", reasoning: "dual" }} />,
    { height: 40 },
  )
  try {
    await ready(setup.app, "Balanced Combo")
    await setup.app.mockInput.typeText("connect")
    await wait(
      () =>
        setup.app.captureCharFrame().includes("Connect another provider…") &&
        !setup.app.captureCharFrame().includes("Balanced Combo"),
    )
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Connect a provider"))
    const providers = setup.app.captureCharFrame()
    expect(providers).toContain("Connected")
    expect(providers).toContain("Mock Provider")

    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("S2 principal"))
    expect(setup.app.captureCharFrame()).toContain("Mock Model")
    expect(setup.app.captureCharFrame()).not.toContain("API key")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("configured setup can edit System Two without walking through System One", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const configured = {
    ...intelligence,
    settings: {
      enabled: true,
      reasoning: "dual",
      onboarding: "completed",
      principal: { providerID: "mock", id: "model" },
      evaluator: {
        transport: "opencode-zen",
        baseURL: "https://opencode.ai/zen/v1",
        model: "jev-1.13-free",
      },
    } as Intelligence.Settings,
    effective: { reasoning: "dual", source: "config" },
  }
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json(configured)
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
    },
    tmp.path,
    () => <Dialogs />,
    { height: 40 },
  )
  try {
    await ready(setup.app, "Change System Two models")
    const mode = setup.app.captureCharFrame()
    expect(mode).toContain("Simple — one model")
    expect(mode).toContain("Dual — S1 classifies")
    expect(mode).toContain("Change System One evaluator")
    expect(mode).toContain("OpenCode Zen · jev-1.13")
    expect(mode).not.toContain("--reasoning")

    await setup.app.mockInput.pressArrow("down")
    await setup.app.mockInput.pressEnter()
    // The cursor lands on the saved principal, below the Providers section.
    await ready(setup.app, "2/2 · S2 principal")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Reuse System Two principal")
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Save global intelligence setup"))
    expect(setup.app.captureCharFrame()).not.toContain("S1 connection")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("single reasoning saves S2 and keeps the saved S1 evaluator without probing it", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const evaluator = {
    transport: "openrouter",
    baseURL: "https://openrouter.ai/api/alpha",
    model: "typesafe/jev-1.13",
    credentialID: "cred_saved",
  }
  const status = {
    ...intelligence,
    settings: { enabled: false, onboarding: "pending", evaluator } as Intelligence.Settings,
  }
  const saved: unknown[] = []
  const probes = { model: 0, evaluator: 0 }
  const setup = await mount(
    async (url, input) => {
      if (url.pathname === "/api/intelligence" && input instanceof Request && input.method === "PUT") {
        saved.push(await input.json())
        return json({ enabled: true, reasoning: "single", onboarding: "completed" })
      }
      if (url.pathname === "/api/intelligence") return json(status)
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
      if (url.pathname === "/api/intelligence/test-model") {
        probes.model++
        return json({ ok: true, message: "Connection checked" })
      }
      if (url.pathname === "/api/intelligence/test") {
        probes.evaluator++
        return json({ ok: true, message: "Connection checked" })
      }
    },
    tmp.path,
    () => <Dialogs />,
  )
  try {
    await ready(setup.app, "Global intelligence · /global")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "2/2 · S2 principal · Mock Provider")
    expect(setup.app.captureCharFrame()).not.toContain("Continue with")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Save global intelligence setup")
    const confirm = setup.app.captureCharFrame()
    // The explanation sits on its own line, whole, at the test width.
    expect(confirm).toContain("S2 only; a saved S1 stays unused")
    expect(confirm).toContain("Change S2 model")
    expect(confirm).not.toContain("S1 connection")
    await setup.app.mockInput.pressEnter()
    await wait(() => saved.length === 1)
    expect(saved[0]).toEqual({
      settings: {
        enabled: true,
        reasoning: "single",
        onboarding: "completed",
        principal: { providerID: "mock", id: "model" },
        evaluator,
      },
    })
    expect(probes).toEqual({ model: 1, evaluator: 0 })
  } finally {
    setup.app.renderer.destroy()
  }
})

test("dual setup with a saved S2 offers Continue and goes straight to S1", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const configured = {
    ...intelligence,
    settings: {
      enabled: true,
      reasoning: "dual",
      onboarding: "completed",
      principal: { providerID: "mock", id: "model" },
      fast: { providerID: "mock", id: "combo" },
      evaluator: {
        transport: "opencode-zen",
        baseURL: "https://opencode.ai/zen/v1",
        model: "jev-1.13-free",
      },
    } as Intelligence.Settings,
    effective: { reasoning: "dual", source: "flag" },
  }
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json(configured)
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
    },
    tmp.path,
    () => <Dialogs />,
  )
  try {
    await ready(setup.app, "--reasoning dual")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Continue with Mock Provider · Mock Model")
    const principal = setup.app.captureCharFrame()
    expect(principal).toContain("2/3 · S2 principal")
    expect(principal).toContain("Change System Two model…")

    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "3/3 · S1 connection")
    expect(setup.app.captureCharFrame()).toContain("Continue with OpenCode Zen · jev-1.13-free")
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Save global intelligence setup"))
  } finally {
    setup.app.renderer.destroy()
  }
})

test("changing a saved S2 keeps the active-connection model list", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const configured = {
    ...intelligence,
    settings: {
      enabled: true,
      reasoning: "single",
      onboarding: "completed",
      principal: { providerID: "mock", id: "model" },
    } as Intelligence.Settings,
    effective: { reasoning: "single", source: "config" },
  }
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json(configured)
      if (url.pathname === "/config/providers")
        return json({ providers: [provider, otherProvider], default: { mock: "model", other: "other" } })
    },
    tmp.path,
    () => <Dialogs />,
    { height: 40 },
  )
  try {
    await ready(setup.app, "Change System Two models")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Continue with Mock Provider · Mock Model")
    await setup.app.mockInput.pressArrow("down")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Balanced Combo")
    const models = setup.app.captureCharFrame()
    expect(models).toContain("2/2 · S2 principal · Mock Provider")
    expect(models).toContain("Mock Model")
    expect(models).not.toContain("Other Model")
    expect(models).toContain("Other Provider")
    expect(models).toContain("Connect another provider…")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("failed OpenRouter probe stays in setup and can be retried with the entered key", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  let probes = 0
  const settings = {
    enabled: false,
    onboarding: "pending",
    principal: { providerID: "mock", id: "model" },
    evaluator: {
      transport: "opencode-zen" as const,
      baseURL: "https://opencode.ai/zen/v1",
      model: "jev-1.13-free",
    },
  } as Intelligence.Settings
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json({ ...intelligence, settings })
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
      if (url.pathname === "/api/intelligence/models")
        return json({ models: [{ id: "typesafe/jev-1.13", name: "typesafe/jev-1.13" }], manual: false })
      if (url.pathname === "/api/intelligence/test-model") return json({ ok: true, message: "Connection checked" })
      if (url.pathname === "/api/intelligence/test") {
        probes++
        return json(
          probes === 1
            ? { ok: false, message: "System One authentication failed (HTTP 401). Check the API key for openrouter." }
            : { ok: true, message: "Connection checked" },
        )
      }
    },
    tmp.path,
    () => <Dialogs resume={{ settings, step: "fast", reasoning: "dual" }} />,
  )
  try {
    await ready(setup.app, "S2 transformations")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Continue with OpenCode Zen · jev-1.13-free")
    // Continue, Cloudflare (connected), OpenCode Zen, then OpenRouter below the visible rows.
    await setup.app.mockInput.pressArrow("down")
    await setup.app.mockInput.pressArrow("down")
    await setup.app.mockInput.pressArrow("down")
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("S1 API base URL"))
    expect(setup.app.captureCharFrame()).toContain("openrouter.ai")
    await setup.app.mockInput.pressEnter()
    await wait(
      () =>
        setup.app.captureCharFrame().includes("S1 API key") &&
        setup.app.renderer.currentFocusedEditor instanceof TextareaRenderable,
    )
    const key = setup.app.renderer.currentFocusedEditor
    if (!(key instanceof TextareaRenderable)) throw new Error("S1 key input is not focused")
    key.setText("openrouter-secret")
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("S1 evaluator"))
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Save global intelligence setup"))

    await setup.app.mockInput.pressEnter()
    await wait(() => probes === 1 && setup.app.captureCharFrame().includes("authentication failed"))

    // The failed S1 probe leaves the cursor on the option that fixes it.
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "3/3 · S1 connection")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Save global intelligence setup")
    await setup.app.mockInput.pressEnter()
    await wait(() => probes === 2)
    await wait(() => !setup.app.captureCharFrame().includes("Save global intelligence setup"))
  } finally {
    setup.app.renderer.destroy()
  }
})

test("a detected RedRouter is the first S1 option and saves its evaluator with the provider credential", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const router = {
    providerID: "red-router",
    baseURL: "http://127.0.0.1:25050/v1",
    detection: {
      kind: "red-router",
      instanceID: "studio",
      features: ["capabilities", "systemone"],
      systemOne: { available: true, models: ["jev-1.13.0"] },
      checkedAt: 0,
    },
    evaluator: {
      transport: "red-router",
      baseURL: "http://127.0.0.1:25050/v1",
      model: "jev-1.13.0",
      credentialID: "cred_router",
    },
  }
  const settings = {
    enabled: false,
    onboarding: "pending",
    principal: { providerID: "mock", id: "model" },
  } as Intelligence.Settings
  const saved: unknown[] = []
  const probed: unknown[] = []
  const setup = await mount(
    async (url, input) => {
      if (url.pathname === "/api/intelligence" && input instanceof Request && input.method === "PUT") {
        saved.push(await input.json())
        return json({ enabled: true, reasoning: "dual", onboarding: "completed" })
      }
      if (url.pathname === "/api/intelligence") return json({ ...intelligence, settings, router })
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
      if (url.pathname === "/api/intelligence/test-model") return json({ ok: true, message: "Connection checked" })
      if (url.pathname === "/api/intelligence/test") {
        if (input instanceof Request) probed.push(await input.json())
        return json({ ok: true, message: "Connection checked" })
      }
    },
    tmp.path,
    () => <Dialogs resume={{ settings, step: "fast", reasoning: "dual" }} />,
  )
  try {
    await ready(setup.app, "S2 transformations")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Use RedRouter studio (detected)")
    const options = setup.app.captureCharFrame()
    expect(options).toContain("3/3 · S1 connection")
    expect(options.indexOf("Use RedRouter studio (detected)")).toBeLessThan(options.indexOf("Cloudflare AI Gateway"))
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Save global intelligence setup")
    expect(setup.app.captureCharFrame()).not.toContain("S1 API key")
    await setup.app.mockInput.pressEnter()
    await wait(() => saved.length === 1)
    expect(probed).toEqual([{ evaluator: router.evaluator }])
    expect(saved[0]).toEqual({
      settings: {
        enabled: true,
        reasoning: "dual",
        onboarding: "completed",
        principal: { providerID: "mock", id: "model" },
        evaluator: router.evaluator,
      },
    })
  } finally {
    setup.app.renderer.destroy()
  }
})

test("the Providers section switches the model list to another connected provider", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const model = (providerID: string, id: string, name: string) => ({
    ...provider.models.model,
    id,
    providerID,
    name,
  })
  const router = {
    ...provider,
    id: "red-router",
    name: "RedRouter",
    models: { alpha: model("red-router", "alpha", "Router Alpha"), beta: model("red-router", "beta", "Router Beta") },
  }
  const openrouter = {
    ...provider,
    id: "openrouter",
    name: "OpenRouter",
    models: { gamma: model("openrouter", "gamma", "Open Gamma"), delta: model("openrouter", "delta", "Open Delta") },
  }
  const saved: unknown[] = []
  const setup = await mount(
    async (url, input) => {
      if (url.pathname === "/api/intelligence" && input instanceof Request && input.method === "PUT") {
        saved.push(await input.json())
        return json({ enabled: true, reasoning: "single", onboarding: "completed" })
      }
      if (url.pathname === "/api/intelligence") return json(intelligence)
      if (url.pathname === "/config/providers")
        return json({ providers: [router, openrouter], default: { "red-router": "alpha", openrouter: "gamma" } })
      if (url.pathname === "/api/intelligence/test-model") return json({ ok: true, message: "Connection checked" })
    },
    tmp.path,
    () => <Dialogs resume={{ settings: intelligence.settings, step: "principal", reasoning: "single" }} />,
    { height: 40 },
  )
  try {
    await ready(setup.app, "Router Beta")
    const models = setup.app.captureCharFrame()
    expect(models).toContain("2/2 · S2 principal · RedRouter")
    expect(models).toContain("2 models · current")
    expect(models).toContain("RedRouter models")
    expect(models).not.toContain("Open Gamma")
    expect(models.indexOf("OpenRouter")).toBeGreaterThan(-1)
    expect(models.indexOf("OpenRouter")).toBeLessThan(models.indexOf("Router Alpha"))

    await setup.app.mockInput.typeText("openrouter")
    await wait(() => !setup.app.captureCharFrame().includes("Router Alpha"))
    await setup.app.mockInput.pressEnter()
    await wait(
      () =>
        setup.app.captureCharFrame().includes("2/2 · S2 principal · OpenRouter") &&
        setup.app.captureCharFrame().includes("Open Gamma"),
    )
    expect(setup.app.captureCharFrame()).not.toContain("Router Beta")

    // After switching, the cursor lands on the new provider's first model.
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Save global intelligence setup")
    await setup.app.mockInput.pressEnter()
    await wait(() => saved.length === 1)
    expect(saved[0]).toMatchObject({ settings: { principal: { providerID: "openrouter", id: "gamma" } } })
  } finally {
    setup.app.renderer.destroy()
  }
})

test("a failed S2 probe names the model and leaves the cursor on Change S2 model", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const settings = {
    enabled: true,
    reasoning: "single",
    onboarding: "completed",
    principal: { providerID: "mock", id: "model" },
  } as Intelligence.Settings
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json({ ...intelligence, settings })
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
      if (url.pathname === "/api/intelligence/test-model")
        return json({ ok: false, message: "Generative connection failed (HTTP 400): Upstream request failed" })
    },
    tmp.path,
    () => <Dialogs resume={{ settings, step: "principal", reasoning: "single" }} />,
    { height: 40 },
  )
  try {
    await ready(setup.app, "Continue with Mock Provider · Mock Model")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Save global intelligence setup")
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("S2 model Mock Provider"))
    expect(setup.app.captureCharFrame()).not.toContain("Generative connection")

    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Mock Provider models")
    const models = setup.app.captureCharFrame()
    expect(models).toContain("2/2 · S2 principal · Mock Provider")
    expect(models).toContain("Balanced Combo")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("setup groups RedRouter models per upstream provider and says where each model comes from", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const router = {
    ...provider,
    id: "red-router",
    name: "RedRouter",
    router: { kind: "red-router" },
    models: {
      "codex/sol": {
        ...provider.models.model,
        id: "codex/sol",
        providerID: "red-router",
        name: "Sol",
        upstream: { id: "codex", slug: "codex", name: "Codex", subscription: true },
        modes: ["review"],
      },
      smart: {
        ...provider.models.model,
        id: "smart",
        providerID: "red-router",
        name: "Smart",
        upstream: { id: "combo", name: "Combo", category: "combo" },
      },
    },
  }
  const codex = {
    ...provider,
    id: "codex",
    name: "Codex",
    models: { sol: { ...provider.models.model, id: "sol", providerID: "codex", name: "Sol" } },
  }
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json(intelligence)
      if (url.pathname === "/config/providers")
        return json({ providers: [router, codex], default: { "red-router": "smart", codex: "sol" } })
    },
    tmp.path,
    () => <Dialogs resume={{ settings: intelligence.settings, step: "principal", reasoning: "single" }} />,
    { height: 40 },
  )
  try {
    await ready(setup.app, "RedRouter · Combo")
    const frame = setup.app.captureCharFrame()
    expect(frame).toContain("2 models · current")
    expect(frame).toContain("1 model · direct")
    expect(frame).toContain("RedRouter · Codex")
    expect(frame).toContain("Sol via RedRouter · Codex")
    expect(frame).toContain("review")
    expect(frame).toContain("Smart via RedRouter · Combo")
    expect(frame.indexOf("RedRouter · Codex")).toBeLessThan(frame.indexOf("RedRouter · Combo"))
  } finally {
    setup.app.renderer.destroy()
  }
})

test("a RedRouter's recommendations come first and are preselected for S2 and S1", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const routed = (id: string, name: string, upstream: { id: string; name: string }) => ({
    ...provider.models.model,
    id,
    providerID: "red-router",
    name,
    upstream,
  })
  const routerProvider = {
    ...provider,
    id: "red-router",
    name: "RedRouter",
    router: { kind: "red-router" },
    models: {
      "cx/gpt-6-luna": routed("cx/gpt-6-luna", "GPT-6 Luna", { id: "codex", name: "OpenAI Codex" }),
      "cc/claude-opus-5-5": routed("cc/claude-opus-5-5", "Claude Opus 5.5", { id: "claude", name: "Claude Code" }),
    },
  }
  const router = {
    providerID: "red-router",
    baseURL: "http://127.0.0.1:25050/v1",
    detection: {
      kind: "red-router",
      instanceID: "studio",
      features: ["capabilities", "systemone", "recommendations"],
      systemOne: { available: true, models: ["jev-latest", "jev-1.13.0"] },
      checkedAt: 0,
    },
    evaluator: {
      transport: "red-router",
      baseURL: "http://127.0.0.1:25050/v1",
      model: "jev-1.13.0",
      credentialID: "cred_router",
    },
    recommended: {
      default: {
        id: "cc/claude-opus-5-5",
        name: "Claude Opus 5.5",
        provider: { slug: "cc", name: "Claude Code" },
        reason: "Strongest connected coding model (claude-opus family, newest version).",
      },
      fast: {
        id: "cx/gpt-6-luna",
        name: "GPT-6 Luna",
        provider: { slug: "cx", name: "OpenAI Codex" },
        reason: "Cheapest capable fast model (gpt-6-luna family).",
      },
      systemone: {
        id: "jev-1.13.0",
        name: "Jev 1.13",
        provider: { slug: "jev", name: "Jev" },
        reason: "First JEV model served on /v1/systemone.",
      },
    },
  }
  const saved: unknown[] = []
  const setup = await mount(
    async (url, input) => {
      if (url.pathname === "/api/intelligence" && input instanceof Request && input.method === "PUT") {
        saved.push(await input.json())
        return json({ enabled: true, reasoning: "dual", onboarding: "completed" })
      }
      if (url.pathname === "/api/intelligence") return json({ ...intelligence, router })
      if (url.pathname === "/config/providers")
        return json({
          providers: [provider, routerProvider],
          default: { mock: "model", "red-router": "cc/claude-opus-5-5" },
        })
      if (url.pathname === "/api/intelligence/test-model") return json({ ok: true, message: "Connection checked" })
      if (url.pathname === "/api/intelligence/test") return json({ ok: true, message: "Connection checked" })
    },
    tmp.path,
    () => <Dialogs resume={{ settings: intelligence.settings, step: "principal", reasoning: "dual" }} />,
    { height: 44 },
  )
  try {
    await ready(setup.app, "Recommended: Claude Opus 5.5")
    await wait(() => setup.app.captureCharFrame().includes("Strongest connected coding model"))
    const principal = setup.app.captureCharFrame()
    expect(principal).toContain("via RedRouter · Claude Code")
    // The Providers section and the active provider's models stay below the recommendation.
    expect(principal.indexOf("Recommended: Claude Opus 5.5")).toBeLessThan(principal.indexOf("Providers"))
    expect(principal).toContain("Mock Provider models")

    // The cursor starts on the recommendation.
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Recommended: GPT-6 Luna")
    const fast = setup.app.captureCharFrame()
    expect(fast).toContain("2/3 · S2 transformations")
    expect(fast).toContain("via RedRouter · OpenAI Codex")
    expect(fast).toContain("Reuse System Two principal")
    expect(fast.indexOf("Recommended: GPT-6 Luna")).toBeLessThan(fast.indexOf("Reuse System Two principal"))

    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Use RedRouter studio (detected)")
    expect(setup.app.captureCharFrame()).toContain("Use RedRouter studio (detected) jev-1.13.0")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Save global intelligence setup")
    await setup.app.mockInput.pressEnter()
    await wait(() => saved.length === 1)
    expect(saved[0]).toEqual({
      settings: {
        enabled: true,
        reasoning: "dual",
        onboarding: "completed",
        principal: { providerID: "red-router", id: "cc/claude-opus-5-5" },
        fast: { providerID: "red-router", id: "cx/gpt-6-luna" },
        evaluator: router.evaluator,
      },
    })
  } finally {
    setup.app.renderer.destroy()
  }
})

test("a recommendation the router does not list is not offered", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const router = {
    providerID: "red-router",
    baseURL: "http://127.0.0.1:25050/v1",
    detection: { kind: "red-router", features: ["capabilities", "recommendations"], checkedAt: 0 },
    recommended: {
      default: {
        id: "cc/claude-opus-5-5",
        name: "Claude Opus 5.5",
        provider: { slug: "cc", name: "Claude Code" },
        reason: "Strongest connected coding model.",
      },
    },
  }
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json({ ...intelligence, router })
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
    },
    tmp.path,
    () => <Dialogs resume={{ settings: intelligence.settings, step: "principal", reasoning: "single" }} />,
    { height: 40 },
  )
  try {
    await ready(setup.app, "Balanced Combo")
    await wait(() => setup.app.captureCharFrame().includes("Mock Provider models"))
    expect(setup.app.captureCharFrame()).not.toContain("Recommended:")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("a saved S2 principal under a router's old alias id resolves to the model's current name", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const router = {
    ...provider,
    id: "red-router",
    name: "RedRouter",
    router: { kind: "red-router" },
    models: {
      "opencode-go/glm-5.3-flash": {
        ...provider.models.model,
        id: "opencode-go/glm-5.3-flash",
        providerID: "red-router",
        name: "GLM 5.3 Flash (Vision)",
        aliases: ["ocg/glm-5.3-flash"],
      },
    },
  }
  const settings = {
    enabled: true,
    reasoning: "single",
    onboarding: "completed",
    // Saved before the router renamed this model to a readable id; only the old alias is stored.
    principal: { providerID: "red-router", id: "ocg/glm-5.3-flash" },
  } as Intelligence.Settings
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json({ ...intelligence, settings })
      if (url.pathname === "/config/providers")
        return json({ providers: [router], default: { "red-router": "opencode-go/glm-5.3-flash" } })
    },
    tmp.path,
    () => <Dialogs resume={{ settings, step: "principal", reasoning: "single" }} />,
  )
  try {
    await ready(setup.app, "Continue with RedRouter · GLM 5.3 Flash (Vision)")
  } finally {
    setup.app.renderer.destroy()
  }
})

test("a saved S2 principal with an id the provider no longer lists falls back to the raw id", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const settings = {
    enabled: true,
    reasoning: "single",
    onboarding: "completed",
    principal: { providerID: "mock", id: "retired-model" },
  } as Intelligence.Settings
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json({ ...intelligence, settings })
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
    },
    tmp.path,
    () => <Dialogs resume={{ settings, step: "principal", reasoning: "single" }} />,
  )
  try {
    await ready(setup.app, "Continue with Mock Provider · retired-model")
  } finally {
    setup.app.renderer.destroy()
  }
})

async function ready(app: Awaited<ReturnType<typeof mount>>["app"], text: string) {
  await wait(() => app.captureCharFrame().includes(text))
  await wait(
    () =>
      app.renderer.currentFocusedRenderable instanceof InputRenderable &&
      !app.renderer.currentFocusedRenderable.isDestroyed,
  )
}
