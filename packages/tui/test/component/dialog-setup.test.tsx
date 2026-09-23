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
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("S2 principal"))
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        !setup.app.renderer.currentFocusedRenderable.isDestroyed,
    )
    const principal = setup.app.captureCharFrame()
    expect(principal).toContain("2/3 · S2 principal · Mock Provider")
    expect(principal).toContain("Mock Model")
    expect(principal).toContain("Balanced Combo")
    expect(principal).not.toContain("Other Model")
    expect(principal).toContain("Choose or connect another provider…")

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
    await wait(() => setup.app.captureCharFrame().includes("Choose or connect another provider…"))
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        !setup.app.renderer.currentFocusedRenderable.isDestroyed,
    )
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
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("Choose or connect another provider…"))
    await setup.app.mockInput.pressArrow("down")
    await setup.app.mockInput.pressArrow("down")
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
  )
  try {
    await ready(setup.app, "Change System Two models")
    const mode = setup.app.captureCharFrame()
    expect(mode).toContain("Simple — one model")
    expect(mode).toContain("Dual — S1 classifies")
    expect(mode).toContain("Change System One evaluator")
    expect(mode).toContain("opencode-zen/jev-1.13")
    expect(mode).not.toContain("--reasoning")

    await setup.app.mockInput.pressArrow("down")
    await setup.app.mockInput.pressEnter()
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
    expect(setup.app.captureCharFrame()).toContain("Single reasoning: S2 only")
    expect(setup.app.captureCharFrame()).not.toContain("S1 connection")
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
    await ready(setup.app, "Continue with Mock Provider / Mock Model")
    const principal = setup.app.captureCharFrame()
    expect(principal).toContain("2/3 · S2 principal")
    expect(principal).toContain("Change System Two model…")

    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "3/3 · S1 connection")
    expect(setup.app.captureCharFrame()).toContain("Continue with opencode-zen/jev-1.13-free")
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
  )
  try {
    await ready(setup.app, "Change System Two models")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Continue with Mock Provider / Mock Model")
    await setup.app.mockInput.pressArrow("down")
    await setup.app.mockInput.pressEnter()
    await ready(setup.app, "Balanced Combo")
    const models = setup.app.captureCharFrame()
    expect(models).toContain("2/2 · S2 principal · Mock Provider")
    expect(models).toContain("Mock Model")
    expect(models).not.toContain("Other Model")
    expect(models).toContain("Choose or connect another provider…")
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
    await ready(setup.app, "Continue with opencode-zen/jev-1.13-free")
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

async function ready(app: Awaited<ReturnType<typeof mount>>["app"], text: string) {
  await wait(() => app.captureCharFrame().includes(text))
  await wait(
    () =>
      app.renderer.currentFocusedRenderable instanceof InputRenderable &&
      !app.renderer.currentFocusedRenderable.isDestroyed,
  )
}
