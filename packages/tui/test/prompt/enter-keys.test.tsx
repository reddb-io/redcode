import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import { TextareaRenderable, type Renderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { Global } from "@reddb-io/redcode-core/global"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

// The real prompt, mounted in the app: every way a terminal reports "newline" must insert one,
// idle or busy. The keymap test covers which reports steer or submit; this one guards the wiring
// of the prompt's own layers (the always-on steer layer above the textarea bindings).
// ESC CR goes first: once a terminal has reported Shift+Enter as CSI 13;2u or CSI 27;2;13~, its
// Shift+Enter cannot be the ESC CR mapping, so a later ESC CR is alt+return and steers.
const newlineReports = [
  ["shift+return mapped to ESC CR", "\x1b\r"],
  ["shift+return, modifyOtherKeys (CSI 27;2;13~, WezTerm and xterm)", "\x1b[27;2;13~"],
  ["shift+return, kitty (CSI 13;2u)", "\x1b[13;2u"],
  ["ctrl+return, modifyOtherKeys (CSI 27;5;13~)", "\x1b[27;5;13~"],
  ["ctrl+j (LF)", "\n"],
] as const

const session = {
  id: "ses_enter",
  title: "Enter keys",
  slug: "enter-keys",
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

for (const busy of [false, true]) {
  test(`the prompt inserts a newline for every newline report ${busy ? "while busy" : "while idle"}`, async () => {
    const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
    const core = await import("@opentui/core")
    mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
    const ready = Promise.withResolvers<TuiPluginApi>()
    const prompts: string[] = []
    const calls = createFetch((url) => {
      if (url.pathname === "/session") return json([session])
      if (url.pathname === `/session/${session.id}`) return json(session)
      if (/^\/session\/[^/]+\/(message|todo|diff)$/.test(url.pathname)) return json([])
      if (url.pathname === "/session/status") return json(busy ? { [session.id]: { type: "busy" } } : {})
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
      if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", permission: [], options: {} }])
      if (url.pathname.includes("prompt")) {
        prompts.push(url.pathname)
        return json({})
      }
    })
    const { run } = await import("../../src/app")
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
    )
    try {
      await ready.promise
      let input: TextareaRenderable | undefined
      for (let attempt = 0; attempt < 200 && !input; attempt++) {
        await setup.renderOnce()
        input = findPromptInput(setup.renderer.root)
        if (!input) await Bun.sleep(10)
      }
      if (!input) throw new Error("prompt input not mounted")
      if (busy) {
        for (let attempt = 0; attempt < 200 && !setup.captureCharFrame().includes("steer"); attempt++) {
          await setup.renderOnce()
          await Bun.sleep(10)
        }
        expect(setup.captureCharFrame()).toContain("steer")
      }
      for (const [name, bytes] of newlineReports) {
        input.focus()
        input.setText("draft")
        input.gotoBufferEnd()
        setup.renderer.stdin.emit("data", Buffer.from(bytes))
        // The steer and submit paths defer twice; give them the chance to run before asserting.
        await Bun.sleep(20)
        await setup.renderOnce()
        expect({ name, text: input.plainText }).toEqual({ name, text: "draft\n" })
      }
      expect(prompts).toEqual([])
    } finally {
      const api = await ready.promise
      api.keymap.dispatchCommand("app.exit")
      await task
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      mock.restore()
    }
  }, 30000)
}
