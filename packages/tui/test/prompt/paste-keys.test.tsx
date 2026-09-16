import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import { TextareaRenderable, type Renderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { Global } from "@reddb-io/redcode-core/global"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

// The real prompt, mounted in the app: every way a terminal reports the paste key must read the
// clipboard, idle or busy. Under the kitty keyboard protocol (which the TUI enables) zellij forwards
// Ctrl+Shift+V as CSI 118;6u instead of the 0x16 byte a legacy pane receives, and dictation tools
// emit Ctrl+Shift+V.
const pasteReports = [
  ["ctrl+v (0x16)", "\x16"],
  ["ctrl+v, kitty (CSI 118;5u)", "\x1b[118;5u"],
  ["ctrl+shift+v, kitty (CSI 118;6u)", "\x1b[118;6u"],
  ["ctrl+shift+v, modifyOtherKeys (CSI 27;6;118~)", "\x1b[27;6;118~"],
] as const

const bracketed = (text: string) => `\x1b[200~${text}\x1b[201~`

const session = {
  id: "ses_paste",
  title: "Paste keys",
  slug: "paste-keys",
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
  test(`the prompt pastes the clipboard for every paste key report ${busy ? "while busy" : "while idle"}`, async () => {
    const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
    const core = await import("@opentui/core")
    mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
    const ready = Promise.withResolvers<TuiPluginApi>()
    // Never touch the real clipboard.
    const clipboard = { text: "", reads: 0 }
    const clipboardStub = {
      read: async () => {
        clipboard.reads++
        return { data: clipboard.text, mime: "text/plain" }
      },
      write: async () => {},
    }
    const calls = createFetch((url) => {
      if (url.pathname === "/session") return json([session])
      if (url.pathname === `/session/${session.id}`) return json(session)
      if (/^\/session\/[^/]+\/(message|todo|diff)$/.test(url.pathname)) return json([])
      if (url.pathname === "/session/status") return json(busy ? { [session.id]: { type: "busy" } } : {})
      if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
      if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", permission: [], options: {} }])
      if (url.pathname.includes("prompt")) return json({})
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
        clipboard: clipboardStub,
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
      const prompt = input
      const send = async (bytes: string, text: string) => {
        prompt.focus()
        prompt.setText("draft ")
        prompt.gotoBufferEnd()
        clipboard.text = text
        setup.renderer.stdin.emit("data", Buffer.from(bytes))
        await Bun.sleep(20)
        await setup.renderOnce()
      }

      for (const [name, bytes] of pasteReports) {
        const readsBefore = clipboard.reads
        const text = `clip ${name}`
        await send(bytes, text)
        expect({ name, text: prompt.plainText, reads: clipboard.reads - readsBefore }).toEqual({
          name,
          text: `draft ${text}`,
          reads: 1,
        })
      }

      // A terminal that forwards the key and also pastes must not insert the clipboard twice,
      // whichever arrives first.
      await send("\x1b[118;6u", "key first")
      setup.renderer.stdin.emit("data", Buffer.from(bracketed("key first")))
      await Bun.sleep(20)
      await setup.renderOnce()
      expect(prompt.plainText).toBe("draft key first")

      await send(bracketed("paste first") + "\x1b[118;6u", "paste first")
      expect(prompt.plainText).toBe("draft paste first")
    } finally {
      const api = await ready.promise
      api.keymap.dispatchCommand("app.exit")
      await task
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      mock.restore()
    }
  }, 30000)
}
