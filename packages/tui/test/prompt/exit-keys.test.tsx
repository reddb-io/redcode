import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import { TextareaRenderable, type Renderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { Global } from "@reddb-io/redcode-core/global"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

// The real app: a bare Ctrl+C never exits on its first press. With text it clears the prompt, while
// the session works it interrupts, in a dialog it closes the dialog, and on an idle empty prompt it
// asks for a second press.
const CTRL_C = "\x03"
const CTRL_D = "\x04"
const CTRL_P = "\x10"

const session = {
  id: "ses_exit",
  title: "Exit keys",
  slug: "exit-keys",
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  time: { created: 0, updated: 0 },
}

const provider = {
  id: "mock",
  name: "Mock",
  env: [],
  options: {},
  source: "config",
  models: {
    model: {
      id: "model",
      providerID: "mock",
      name: "Model",
      capabilities: {},
      limit: { context: 1000, output: 100 },
      cost: {},
    },
  },
}

function findPromptInput(node: Renderable): TextareaRenderable | undefined {
  if (node instanceof TextareaRenderable && node.constructor === TextareaRenderable) return node
  for (const child of node.getChildren()) {
    const found = findPromptInput(child as Renderable)
    if (found) return found
  }
}

async function mountApp(busy: boolean) {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const ready = Promise.withResolvers<TuiPluginApi>()
  const aborts: string[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/session") return json([session])
    if (url.pathname === `/session/${session.id}`) return json(session)
    if (/^\/session\/[^/]+\/(message|todo|diff)$/.test(url.pathname)) return json([])
    if (url.pathname === "/session/status") return json(busy ? { [session.id]: { type: "busy" } } : {})
    if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
    if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", permission: [], options: {} }])
    if (url.pathname.endsWith("/abort")) {
      aborts.push(url.pathname)
      return json(true)
    }
  })
  const { run } = await import("../../src/app")
  const state = { exited: false }
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch: calls.fetch,
      events: createEventSource().source,
      args: { sessionID: session.id },
      pluginHost: {
        async start(input) {
          input.runtime.setupSlots(input.api)
          ready.resolve(input.api)
        },
        async dispose() {},
      },
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
  ).finally(() => {
    state.exited = true
  })

  await ready.promise
  const input = await waitFor(setup, () => findPromptInput(setup.renderer.root))
  if (busy) await waitFor(setup, () => setup.captureCharFrame().includes("steer"))
  input.focus()

  return {
    setup,
    input,
    aborts,
    state,
    async press(bytes: string) {
      setup.renderer.stdin.emit("data", Buffer.from(bytes))
      await Bun.sleep(20)
      await setup.renderOnce()
    },
    frame: () => setup.captureCharFrame(),
    async dispose() {
      if (!state.exited) (await ready.promise).keymap.dispatchCommand("app.exit")
      await task
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      mock.restore()
    },
  }
}

async function waitFor<T>(setup: { renderOnce(): Promise<void> }, check: () => T | undefined | false) {
  for (let attempt = 0; attempt < 200; attempt++) {
    await setup.renderOnce()
    const value = check()
    if (value) return value
    await Bun.sleep(10)
  }
  throw new Error("condition not met")
}

test("idle: ctrl+c clears typed text, then asks for a second press before it exits", async () => {
  const app = await mountApp(false)
  try {
    app.input.setText("draft")
    await app.setup.renderOnce()
    await app.press(CTRL_C)
    expect(app.input.plainText).toBe("")
    expect(app.frame()).not.toContain("again to exit")
    expect(app.state.exited).toBe(false)

    await app.press(CTRL_C)
    expect(app.frame()).toContain("Press ctrl+c again to exit")
    expect(app.state.exited).toBe(false)

    await app.press(CTRL_C)
    await waitFor(app.setup, () => app.state.exited)
  } finally {
    await app.dispose()
  }
}, 30000)

test("idle: ctrl+d asks for a second ctrl+d, and ctrl+c does not complete it", async () => {
  const app = await mountApp(false)
  try {
    await app.press(CTRL_D)
    expect(app.frame()).toContain("Press ctrl+d again to exit")
    await app.press(CTRL_C)
    expect(app.state.exited).toBe(false)
    expect(app.frame()).toContain("Press ctrl+c again to exit")
  } finally {
    await app.dispose()
  }
}, 30000)

test("busy: ctrl+c interrupts the session and never exits", async () => {
  const app = await mountApp(true)
  try {
    await app.press(CTRL_C)
    await waitFor(app.setup, () => app.aborts.length === 1)
    expect(app.aborts).toEqual([`/session/${session.id}/abort`])
    await app.press(CTRL_C)
    await waitFor(app.setup, () => app.aborts.length === 2)
    expect(app.state.exited).toBe(false)
  } finally {
    await app.dispose()
  }
}, 30000)

test("a dialog: ctrl+c closes it without arming an exit", async () => {
  const app = await mountApp(false)
  try {
    const before = app.frame()
    await app.press(CTRL_P)
    await waitFor(app.setup, () => app.frame() !== before)
    await app.press(CTRL_C)
    expect(app.state.exited).toBe(false)
    expect(app.frame()).not.toContain("again to exit")
  } finally {
    await app.dispose()
  }
}, 30000)
