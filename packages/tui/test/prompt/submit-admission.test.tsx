import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import { TextareaRenderable, type Renderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { Global } from "@reddb-io/redcode-core/global"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

// The real prompt, mounted in the app: Enter sends the prompt through `prompt_async`, which answers
// once the prompt is admitted, under a message ID the TUI names. A transient failure is sent again
// with the same ID (the server's exact retry, never a second prompt), and a send that fails for good
// leaves the text in the input.

const session = {
  id: "ses_submit",
  title: "Submit",
  slug: "submit",
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

type Send = { path: string; body: { messageID?: string; delivery?: string; parts?: Array<{ text?: string }> } }

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

async function submitWith(text: string, answer: (attempt: number) => Response) {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const ready = Promise.withResolvers<TuiPluginApi>()
  const sends: Send[] = []
  const posts: string[] = []
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/session") return json([session])
    if (url.pathname === `/session/${session.id}`) return json(session)
    if (url.pathname === `/session/${session.id}/prompt_async`) {
      const body = request instanceof Request ? await request.json() : {}
      sends.push({ path: url.pathname, body })
      return answer(sends.length - 1)
    }
    if (request instanceof Request && request.method === "POST") posts.push(url.pathname)
    if (/^\/session\/[^/]+\/(message|todo|diff)$/.test(url.pathname)) return json([])
    if (url.pathname === "/session/status") return json({})
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
  input.focus()
  input.setText(text)
  input.gotoBufferEnd()
  setup.renderer.stdin.emit("data", Buffer.from("\r"))
  return {
    input,
    sends,
    posts,
    render,
    frame: () => setup.captureCharFrame(),
    async close() {
      const api = await ready.promise
      api.keymap.dispatchCommand("app.exit")
      await task
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      mock.restore()
    },
  }
}

test("Enter sends through prompt_async under a client message ID, and retries a transient failure with it", async () => {
  const app = await submitWith("hello admission", (attempt) =>
    attempt === 0 ? new Response("unavailable", { status: 503 }) : new Response(null, { status: 204 }),
  )
  try {
    await until(() => app.sends.length >= 2 && app.input.plainText === "", app.render)
    expect(app.sends).toHaveLength(2)
    const [first, retry] = app.sends
    expect(first!.body.messageID).toStartWith("msg_")
    // The same ID: the server takes the retry as the same prompt, never a second one.
    expect(retry!.body.messageID).toBe(first!.body.messageID!)
    expect(first!.body.delivery).toBe("queue")
    expect(first!.body.parts?.some((part) => part.text === "hello admission")).toBe(true)
    // Admitted, then cleared; the long synchronous send is not used.
    expect(app.input.plainText).toBe("")
    expect(app.posts).not.toContain(`/session/${session.id}/message`)
  } finally {
    await app.close()
  }
}, 30000)

test("a send the server refuses keeps the prompt text and says so", async () => {
  const app = await submitWith("keep this prompt", () => json({ name: "BadRequest", data: {} }, { status: 400 }))
  try {
    await until(() => app.frame().includes("Failed to send prompt"), app.render)
    expect(app.frame()).toContain("Failed to send prompt")
    // Refused, not transient: sent once, not retried.
    expect(app.sends).toHaveLength(1)
    expect(app.input.plainText).toBe("keep this prompt")
  } finally {
    await app.close()
  }
}, 30000)
