/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
import type { TuiPluginApi, TuiPluginMeta } from "@reddb-io/redcode-plugin/tui"
import type { AssistantMessage, Message } from "@reddb-io/redcode-sdk/v2"
import sidebarContext from "../../src/feature-plugins/sidebar/context"
import { createTuiPluginApi } from "../fixture/tui-plugin"

const pluginMeta = {
  id: "sidebar-context",
  source: "internal",
  spec: "sidebar-context",
  target: "sidebar-context",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
} satisfies TuiPluginMeta

const bright = RGBA.fromInts(250, 250, 250)
const muted = RGBA.fromInts(120, 120, 120)

const user = (id: string) => ({ id, role: "user", sessionID: "s", time: { created: 1 } }) as unknown as Message

const assistant = (id: string, input: Partial<AssistantMessage> = {}) =>
  ({
    id,
    role: "assistant",
    sessionID: "s",
    parentID: "u1",
    providerID: "p",
    modelID: "m",
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, completed: 2 },
    ...input,
  }) as Message

test("shows the latest step, skipping a compaction summary written after it", async () => {
  const app = await renderSidebar([
    user("u1"),
    assistant("a1", { timing: { firstToken: 5, ttftMs: 820, visibleMs: 2_400, tokens: 240, genMs: 1_500 } }),
    // A replayed summary: first and completed a few milliseconds apart.
    assistant("sum", { summary: true, timing: { replayed: true }, time: { created: 3, completed: 4 } }),
  ])
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("820ms latency · 2.4s to output")
    expect(frame).toContain("160 tk/s")
    expect(frame).not.toContain("turn")
  } finally {
    app.renderer.destroy()
  }
})

test("a burst shows a marker instead of a local write speed", async () => {
  const app = await renderSidebar([
    user("u1"),
    assistant("a1", { timing: { firstToken: 5, ttftMs: 3_100, tokens: 400, genMs: 6, burst: true } }),
  ])
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("3.1s latency")
    expect(frame).toContain("burst · not streamed")
    expect(frame).not.toContain("tk/s")
  } finally {
    app.renderer.destroy()
  }
})

test("messages recorded before timing existed show nothing", async () => {
  const app = await renderSidebar([user("u1"), assistant("a1", { time: { created: 1, first: 2, completed: 45_000 } })])
  try {
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("latency")
    expect(frame).not.toContain("tk/s")
  } finally {
    app.renderer.destroy()
  }
})

test("the streaming step is bright, a finished or aborted one is muted", async () => {
  const live = await renderSidebar([
    user("u1"),
    assistant("a1", { timing: { firstToken: 5, ttftMs: 640, tokens: 90, genMs: 900 } }),
    assistant("a2", { time: { created: 3 }, timing: { firstToken: 6, ttftMs: 510, genMs: 200 } }),
  ])
  try {
    expect(colorOf(live, "510ms latency")).toEqual(bright)
    expect(live.captureCharFrame()).toContain("turn · 640ms · 100 tk/s")
  } finally {
    live.renderer.destroy()
  }

  const aborted = await renderSidebar([
    user("u1"),
    assistant("a1", {
      time: { created: 3, completed: 4 },
      error: { name: "MessageAbortedError", data: { message: "Aborted" } },
      timing: { firstToken: 6, ttftMs: 510, genMs: 200 },
    }),
  ])
  try {
    expect(aborted.captureCharFrame()).toContain("510ms latency · aborted")
    expect(colorOf(aborted, "510ms latency")).toEqual(muted)
  } finally {
    aborted.renderer.destroy()
  }
})

function colorOf(app: Awaited<ReturnType<typeof testRender>>, text: string) {
  return app
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((span) => span.text.includes(text))?.fg
}

async function renderSidebar(messages: Message[]) {
  let render: (() => JSX.Element) | undefined
  const base = createTuiPluginApi()
  const api = {
    ...base,
    theme: { current: new Proxy({}, { get: (_, key) => (key === "text" ? bright : muted) }) },
    state: {
      ...base.state,
      config: {},
      provider: [],
      session: { get: () => ({ id: "s", cost: 0 }), messages: () => messages },
    },
    slots: {
      register(input: Parameters<TuiPluginApi["slots"]["register"]>[0]) {
        render = () =>
          (input.slots.sidebar_content as (ctx: unknown, props: { session_id: string }) => JSX.Element)(
            {},
            { session_id: "s" },
          )
        return "sidebar-context"
      },
    },
  } as unknown as TuiPluginApi

  await sidebarContext.tui(api, undefined, pluginMeta)
  if (!render) throw new Error("sidebar context slot was not registered")
  const app = await testRender(render, { width: 60, height: 14 })
  await app.renderOnce()
  return app
}
