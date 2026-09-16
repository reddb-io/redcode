/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import {
  type ConnectedProvider,
  DialogOpenAICompatible,
  type ProviderLookup,
  type ProviderPreset,
} from "../../src/component/dialog-openai-compatible"
import { useDialog } from "../../src/ui/dialog"
import { mountDialog } from "../fixture/dialog"
import { tmpdir } from "../fixture/fixture"
import { eventSource } from "../fixture/tui-sdk"
import { wait } from "../cli/cmd/tui/sync-fixture"

const CONNECT = "/provider/openai-compatible/connect"

const PRESET: ProviderPreset = {
  providerID: "9router",
  name: "9Router",
  defaultURL: "http://127.0.0.1:20128/v1",
  urlHint: "Start 9Router.",
  keyHint: "Copy a key from the 9Router dashboard.",
}

function result(body: Record<string, unknown>): ConnectedProvider {
  return {
    providerID: String(body.providerID),
    name: String(body.name ?? body.providerID),
    baseURL: String(body.baseURL),
    npm: String(body.npm),
    models: [{ id: "m", name: "m", limit: { context: 128000, output: 8192 }, estimated: true }],
    discovered: !body.models,
    credential: "stored",
    configPath: "/home/test/.red/code/config.jsonc",
  }
}

type Reply = (body: Record<string, unknown>) => Response

async function mountWizard(input: {
  root: string
  reply?: Reply
  preset?: ProviderPreset
  providerID?: string
  offerMove?: boolean
  lookup?: (id: string) => ProviderLookup
  onConnected?: (result: ConnectedProvider) => Promise<void>
}) {
  const bodies: Array<Record<string, unknown>> = []
  const connected: ConnectedProvider[] = []
  const gate = { hold: undefined as Promise<void> | undefined }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path !== CONNECT) return Response.json({})
      const body = (await request.json()) as Record<string, unknown>
      bodies.push(body)
      if (gate.hold) await gate.hold
      return (input.reply ?? ((body) => Response.json(result(body))))(body)
    },
  })
  function Open() {
    const dialog = useDialog()
    onMount(() =>
      dialog.replace(() => (
        <DialogOpenAICompatible
          preset={input.preset}
          providerID={input.providerID}
          offerMove={input.offerMove}
          lookup={input.lookup ?? (() => ({ taken: false }))}
          onConnected={async (value) => {
            connected.push(value)
            await input.onConnected?.(value)
          }}
        />
      )),
    )
    return null
  }
  const app = await mountDialog({
    root: input.root,
    sdk: { url: server.url.href, events: eventSource() },
    children: () => <Open />,
  })
  const frame = () => app.captureCharFrame()
  return {
    app,
    bodies,
    connected,
    gate,
    frame,
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await server.stop(true)
    },
    async step(title: string) {
      await wait(() => frame().includes(title))
    },
    /** Replaces the prompt's text (or accepts the prefilled text with `undefined`) and submits it. */
    async input(title: string, value?: string) {
      await wait(() => frame().includes(title) && app.renderer.currentFocusedEditor instanceof TextareaRenderable)
      const textarea = app.renderer.currentFocusedEditor
      if (!(textarea instanceof TextareaRenderable)) throw new Error("Wizard input not focused")
      if (value !== undefined) textarea.setText(value)
      await app.mockInput.pressEnter()
      await app.renderOnce()
    },
    async select(title: string, down = 0) {
      await wait(() => frame().includes(title))
      await app.renderOnce()
      for (let index = 0; index < down; index++) await app.mockInput.pressArrow("down")
      await app.mockInput.pressEnter()
      await app.renderOnce()
    },
  }
}

test("walks from URL to key and connects with a suggested id, name and an environment reference", async () => {
  await using tmp = await tmpdir()
  await using wizard = await mountWizard({ root: tmp.path })
  await wizard.input("OpenAI-compatible · API URL", "api.together.xyz")
  await wizard.step("together")
  await wizard.input("OpenAI-compatible · Provider id")
  await wizard.input("OpenAI-compatible · Display name")
  await wizard.select("OpenAI-compatible · API type")
  await wizard.input("OpenAI-compatible · API key", " {env:TOGETHER_KEY} ")
  await wait(() => wizard.connected.length === 1)
  expect(wizard.bodies).toEqual([
    {
      providerID: "together",
      name: "Together",
      baseURL: "http://api.together.xyz/v1",
      apiKey: "{env:TOGETHER_KEY}",
      npm: "@ai-sdk/openai-compatible",
    },
  ])
})

test("a failed model list leads to entering models by hand instead of a dead end", async () => {
  await using tmp = await tmpdir()
  await using wizard = await mountWizard({
    root: tmp.path,
    reply: (body) =>
      body.models
        ? Response.json(result(body))
        : Response.json(
            { reason: "discovery", message: "The provider listed no models. Enter model ids instead." },
            { status: 400 },
          ),
  })
  await wizard.input("OpenAI-compatible · API URL", "http://127.0.0.1:8000/v1")
  await wizard.input("OpenAI-compatible · Provider id", "local")
  await wizard.input("OpenAI-compatible · Display name", "Local")
  await wizard.select("OpenAI-compatible · API type", 1)
  await wizard.input("OpenAI-compatible · API key", "")
  await wizard.step("OpenAI-compatible · Models")
  await wait(() => wizard.frame().includes("listed no models"))
  await wizard.input("OpenAI-compatible · Models", "bad size")
  await wait(() => wizard.frame().includes("not a context size"))
  expect(wizard.bodies).toHaveLength(1)
  await wizard.input("OpenAI-compatible · Models", "qwen2.5-coder 32k, llama3")
  await wait(() => wizard.connected.length === 1)
  expect(wizard.bodies[1]).toEqual({
    providerID: "local",
    name: "Local",
    baseURL: "http://127.0.0.1:8000/v1",
    npm: "@ai-sdk/openai",
    models: [{ id: "qwen2.5-coder", context: 32000 }, { id: "llama3" }],
  })
})

test("cancelling before or during the final step reports no connection", async () => {
  await using tmp = await tmpdir()
  await using early = await mountWizard({ root: tmp.path })
  await early.input("OpenAI-compatible · API URL", "https://gateway.example.com/v1")
  await early.step("OpenAI-compatible · Provider id")
  await early.app.mockInput.pressEscape()
  await early.app.renderOnce()
  expect(early.frame()).not.toContain("OpenAI-compatible ·")
  expect(early.bodies).toEqual([])

  await using late = await mountWizard({ root: tmp.path })
  const hold = Promise.withResolvers<void>()
  late.gate.hold = hold.promise
  await late.input("OpenAI-compatible · API URL", "https://gateway.example.com/v1")
  await late.input("OpenAI-compatible · Provider id")
  await late.input("OpenAI-compatible · Display name")
  await late.select("OpenAI-compatible · API type")
  await late.input("OpenAI-compatible · API key", "sk-test")
  await wait(() => late.bodies.length === 1)
  late.app.mockInput.pressEnter()
  late.app.mockInput.pressEscape()
  hold.resolve()
  await late.app.renderOnce()
  await Bun.sleep(50)
  expect(late.bodies).toHaveLength(1)
  expect(late.connected).toEqual([])
  expect(late.frame()).not.toContain("OpenAI-compatible · API key")
})

test("reopening a configured provider prefills it and keeps the saved key when left empty", async () => {
  await using tmp = await tmpdir()
  await using wizard = await mountWizard({
    root: tmp.path,
    providerID: "gateway",
    lookup: (id) => ({
      taken: false,
      existing:
        id === "gateway"
          ? {
              name: "My Gateway",
              baseURL: "https://gw.example.com/v1",
              npm: "@ai-sdk/openai",
              hasKey: true,
              hasModels: true,
            }
          : undefined,
    }),
  })
  await wizard.step("https://gw.example.com/v1")
  await wizard.input("OpenAI-compatible · API URL")
  await wizard.step("My Gateway")
  await wizard.input("OpenAI-compatible · Display name")
  await wizard.select("OpenAI-compatible · API type")
  await wizard.step("Leave it empty to keep the saved key")
  await wizard.input("OpenAI-compatible · API key", "")
  await wait(() => wizard.connected.length === 1)
  expect(wizard.bodies).toEqual([
    { providerID: "gateway", name: "My Gateway", baseURL: "https://gw.example.com/v1", npm: "@ai-sdk/openai" },
  ])
})

test("a built-in id asks before overriding, locally or when the server refuses it", async () => {
  await using tmp = await tmpdir()
  let refused = false
  await using wizard = await mountWizard({
    root: tmp.path,
    lookup: (id) => ({ taken: id === "openai" }),
    reply: (body) => {
      if (body.providerID === "mistral" && !body.override) {
        refused = true
        return Response.json(
          { reason: "builtin_provider", message: '"mistral" is a built-in provider.' },
          { status: 400 },
        )
      }
      return Response.json(result(body))
    },
  })
  await wizard.input("OpenAI-compatible · API URL", "https://proxy.example.com/v1")
  await wizard.input("OpenAI-compatible · Provider id", "openai")
  await wizard.select('"openai" is already a provider')
  await wizard.input("OpenAI-compatible · Provider id", "mistral")
  await wizard.input("OpenAI-compatible · Display name")
  await wizard.select("OpenAI-compatible · API type")
  await wizard.input("OpenAI-compatible · API key", "sk-proxy")
  await wait(() => refused)
  await wizard.select('"mistral" is already a provider', 1)
  await wait(() => wizard.connected.length === 1)
  expect(wizard.bodies.map((body) => [body.providerID, body.override])).toEqual([
    ["mistral", undefined],
    ["mistral", true],
  ])
})

test("the 9Router preset only asks for the URL and key", async () => {
  await using tmp = await tmpdir()
  await using wizard = await mountWizard({ root: tmp.path, preset: PRESET })
  await wizard.step("http://127.0.0.1:20128/v1")
  await wizard.input("9Router · API URL")
  await wizard.input("9Router · API key", "")
  await wait(() => wizard.frame().includes("Enter the API key from your 9Router dashboard"))
  expect(wizard.bodies).toEqual([])
  await wizard.input("9Router · API key", "router-key")
  await wait(() => wizard.connected.length === 1)
  expect(wizard.bodies).toEqual([
    {
      providerID: "9router",
      name: "9Router",
      baseURL: "http://127.0.0.1:20128/v1",
      apiKey: "router-key",
      npm: "@ai-sdk/openai-compatible",
    },
  ])
})

test("a 9Router connection to another address can move to its own id", async () => {
  await using tmp = await tmpdir()
  await using wizard = await mountWizard({
    root: tmp.path,
    preset: PRESET,
    offerMove: true,
    lookup: (id) => ({
      taken: false,
      existing:
        id === "9router"
          ? {
              name: "9Router",
              baseURL: "https://llm.gateway.dev/v1",
              npm: "@ai-sdk/openai-compatible",
              hasKey: true,
              hasModels: true,
            }
          : undefined,
    }),
  })
  await wizard.select("9Router points to another address", 1)
  await wizard.input("OpenAI-compatible · API URL")
  await wizard.step("gateway")
  await wizard.input("OpenAI-compatible · Provider id")
  await wizard.input("OpenAI-compatible · Display name")
  await wizard.select("OpenAI-compatible · API type")
  await wizard.input("OpenAI-compatible · API key", "")
  await wait(() => wizard.connected.length === 1)
  expect(wizard.bodies).toEqual([
    {
      providerID: "gateway",
      name: "Gateway",
      baseURL: "https://llm.gateway.dev/v1",
      npm: "@ai-sdk/openai-compatible",
      moveFrom: "9router",
    },
  ])
})

test("a problem found after connecting is shown in the wizard", async () => {
  await using tmp = await tmpdir()
  await using wizard = await mountWizard({
    root: tmp.path,
    preset: PRESET,
    onConnected: async () => {
      throw new Error("Project override found")
    },
  })
  await wizard.input("9Router · API URL")
  await wizard.input("9Router · API key", "router-key")
  await wait(() => wizard.frame().includes("Project override found"))
})
