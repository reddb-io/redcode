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

function Dialogs(props: { resume?: { settings: Intelligence.Settings; step: "principal" | "fast" } } = {}) {
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
}

test("global setup selects System Two models and offers provider connection in the same flow", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await mount(
    (url) => {
      if (url.pathname === "/api/intelligence") return json(intelligence)
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
    },
    tmp.path,
    () => <Dialogs resume={{ settings: intelligence.settings, step: "principal" }} />,
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("System Two principal"))
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        !setup.app.renderer.currentFocusedRenderable.isDestroyed,
    )
    const principal = setup.app.captureCharFrame()
    expect(principal).toContain("Mock Model")
    expect(principal).toContain("Choose or connect provider…")

    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("System Two transformations"))
    await setup.app.renderOnce()
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        !setup.app.renderer.currentFocusedRenderable.isDestroyed,
    )
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("System One connection"))
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
    () => <Dialogs resume={{ settings: intelligence.settings, step: "principal" }} />,
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("System Two principal"))
    await wait(
      () =>
        setup.app.renderer.currentFocusedRenderable instanceof InputRenderable &&
        !setup.app.renderer.currentFocusedRenderable.isDestroyed,
    )
    await wait(() => setup.app.captureCharFrame().includes("Choose or connect provider…"))
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
    () => <Dialogs resume={{ settings: intelligence.settings, step: "principal" }} />,
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("Choose or connect provider…"))
    await setup.app.mockInput.pressArrow("down")
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Connect a provider"))
    const providers = setup.app.captureCharFrame()
    expect(providers).toContain("Connected")
    expect(providers).toContain("Mock Provider")

    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("System Two principal"))
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
    settings: {
      enabled: true,
      onboarding: "completed",
      principal: { providerID: "mock", id: "model" },
      evaluator: {
        transport: "opencode-zen",
        baseURL: "https://opencode.ai/zen/v1",
        model: "jev-1.13-free",
      },
    } as Intelligence.Settings,
    environment: "/global",
    evaluators: intelligence.evaluators,
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
    await wait(() => setup.app.captureCharFrame().includes("Change System Two models"))
    const welcome = setup.app.captureCharFrame()
    expect(welcome).toContain("Change System One evaluator")
    expect(welcome).not.toContain("Later")
    expect(welcome).not.toContain("Disable semantic evaluation")
    expect(welcome).toContain("mock/model")
    expect(welcome).toContain("opencode-zen/jev-1.13-fr")

    await setup.app.mockInput.pressArrow("down")
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("System Two principal"))
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Reuse System Two principal"))
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("Save global intelligence setup"))
    expect(setup.app.captureCharFrame()).not.toContain("System One connection")
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
    () => <Dialogs resume={{ settings, step: "fast" }} />,
  )
  try {
    await wait(() => setup.app.captureCharFrame().includes("System Two transformations"))
    await setup.app.mockInput.pressEnter()
    await wait(
      () =>
        setup.app.captureCharFrame().includes("System One connection") &&
        setup.app.captureCharFrame().includes("OpenRouter"),
    )
    await setup.app.mockInput.pressArrow("down")
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("System One API base URL"))
    await setup.app.mockInput.pressEnter()
    await wait(
      () =>
        setup.app.captureCharFrame().includes("System One API key") &&
        setup.app.renderer.currentFocusedEditor instanceof TextareaRenderable,
    )
    const key = setup.app.renderer.currentFocusedEditor
    if (!(key instanceof TextareaRenderable)) throw new Error("System One key input is not focused")
    key.setText("openrouter-secret")
    await setup.app.mockInput.pressEnter()
    await wait(() => setup.app.captureCharFrame().includes("System One evaluator"))
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
