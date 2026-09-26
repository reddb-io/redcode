import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import { TextareaRenderable, type Renderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { Global } from "@reddb-io/redcode-core/global"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

// The real prompt, mounted in the app: while the agent works, Enter steers (the prompt reaches it
// at its next step) and Alt+Enter, in every encoding a terminal sends it, or `/queue <text>` queues
// (the prompt waits for the turn to end). Idle, Enter and Alt+Enter both just send.

const session = {
  id: "ses_delivery",
  title: "Delivery",
  slug: "delivery",
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

const intelligence = {
  settings: { enabled: false, onboarding: "completed" },
  environment: "/global",
  evaluators: [],
  effective: { reasoning: "single", source: "default" },
}

type Send = { delivery?: string; text?: string }

function findPromptInput(node: Renderable): TextareaRenderable | undefined {
  if (node instanceof TextareaRenderable && node.constructor === TextareaRenderable) return node
  for (const child of node.getChildren()) {
    const found = findPromptInput(child as Renderable)
    if (found) return found
  }
}

async function until(check: () => boolean, render: () => Promise<void>, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!check() && Date.now() < deadline) {
    await render()
    await Bun.sleep(10)
  }
}

async function mount(busy: boolean) {
  const setup = await createTestRenderer({ width: 120, height: 30, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const ready = Promise.withResolvers<TuiPluginApi>()
  const sends: Send[] = []
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/session") return json([session])
    if (url.pathname === `/session/${session.id}`) return json(session)
    if (url.pathname === `/session/${session.id}/prompt_async`) {
      const body = (request instanceof Request ? await request.json() : {}) as {
        delivery?: string
        parts?: Array<{ type: string; text?: string }>
      }
      sends.push({ delivery: body.delivery, text: body.parts?.find((part) => part.type === "text")?.text })
      return new Response(null, { status: 204 })
    }
    if (/^\/session\/[^/]+\/(message|todo|diff)$/.test(url.pathname)) return json([])
    if (url.pathname === "/session/status") return json(busy ? { [session.id]: { type: "busy" } } : {})
    if (url.pathname === "/config/providers") return json({ providers: [provider], default: { mock: "model" } })
    if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", permission: [], options: {} }])
    if (url.pathname === "/api/intelligence") return json(intelligence)
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
  const render = () => setup.renderOnce()
  await ready.promise
  let input: TextareaRenderable | undefined
  await until(() => {
    input = findPromptInput(setup.renderer.root)
    return input !== undefined
  }, render)
  if (!input) throw new Error("prompt input not mounted")
  const prompt = input
  if (busy) await until(() => setup.captureCharFrame().includes("queue"), render)
  return {
    sends,
    frame: () => setup.captureCharFrame(),
    emit(bytes: string) {
      setup.renderer.stdin.emit("data", Buffer.from(bytes))
    },
    /** Types `text` and presses the key `bytes` encode, then waits for the send to be admitted. */
    async send(text: string, bytes: string) {
      const before = sends.length
      prompt.focus()
      prompt.setText(text)
      prompt.gotoBufferEnd()
      setup.renderer.stdin.emit("data", Buffer.from(bytes))
      await until(() => sends.length > before && prompt.plainText === "", render)
      return sends.slice(before)
    },
    async close() {
      const api = await ready.promise
      api.keymap.dispatchCommand("app.exit")
      await task
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      mock.restore()
    },
  }
}

test("while busy, Enter steers and Alt+Enter or /queue queue", async () => {
  const app = await mount(true)
  try {
    // The hint names what each key does.
    expect(app.frame()).toMatch(/steer · \S+ queue/)
    expect(await app.send("use the other API", "\r")).toEqual([{ delivery: "steer", text: "use the other API" }])
    expect(await app.send("then run the tests", "\x1b[13;3u")).toEqual([
      { delivery: "queue", text: "then run the tests" },
    ])
    expect(await app.send("then lint", "\x1b[27;3;13~")).toEqual([{ delivery: "queue", text: "then lint" }])
    expect(await app.send("/queue then commit", "\r")).toEqual([{ delivery: "queue", text: "then commit" }])
    // A terminal that has reported Shift+Enter as CSI 13;2u does not map it to ESC CR, so a bare ESC
    // CR from then on is Alt+Enter (zellij and tmux forward it that way) and queues.
    app.emit("\x1b[13;2u")
    expect(await app.send("then push", "\x1b\r")).toEqual([{ delivery: "queue", text: "then push" }])
  } finally {
    await app.close()
  }
}, 30000)

test("while idle, Enter and Alt+Enter both just send", async () => {
  const app = await mount(false)
  try {
    expect(await app.send("first", "\r")).toEqual([{ delivery: "steer", text: "first" }])
    expect(await app.send("second", "\x1b[13;3u")).toEqual([{ delivery: "steer", text: "second" }])
    expect(await app.send("third", "\x1b[27;3;13~")).toEqual([{ delivery: "steer", text: "third" }])
  } finally {
    await app.close()
  }
}, 30000)

test("/queue on an idle session sends right away, queued", async () => {
  const app = await mount(false)
  try {
    // An idle session has nothing to wait for, so the server runs a queued prompt at once.
    expect(await app.send("/queue later", "\r")).toEqual([{ delivery: "queue", text: "later" }])
  } finally {
    await app.close()
  }
}, 30000)
