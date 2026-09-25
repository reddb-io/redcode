import { afterEach, expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { Global } from "@reddb-io/redcode-core/global"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json, worktree } from "../fixture/tui-sdk"

const location = [worktree, "⎇ primary checkout", "⑂ main"]

const mcp = { github: { status: "connected" } }
const lsp = [{ id: "typescript", name: "typescript", root: ".", status: "connected" }]

const shows = (lines: string[], ...texts: string[]) => texts.every((text) => lines.some((line) => line.includes(text)))

afterEach(() => mock.restore())

test("with tasks the location block sits above the task list and the list is cut short", async () => {
  const todos = Array.from({ length: 12 }, (_, index) => ({
    content: `Task ${index + 1}`,
    status: index === 0 ? "in_progress" : "pending",
    priority: "medium",
  }))
  const app = await mountSidebar({ todos, height: 24 })
  try {
    const lines = await app.waitFor((lines) => shows(lines, "Todo", ...location))
    const rows = [...location, "Todo"].map((text) => lines.findIndex((line) => line.includes(text)))

    expect(rows.every((row) => row >= 0)).toBe(true)
    expect(rows).toEqual([...rows].sort((a, b) => a - b))
    expect(lines.some((line) => /\+\d+ more/.test(line))).toBe(true)
    expect(lines.some((line) => line.includes("Task 12"))).toBe(false)

    await app.close()
  } finally {
    app.destroy()
  }
}, 45_000)

test("without tasks the location block stays at the bottom", async () => {
  const app = await mountSidebar({ mcp, lsp, height: 40 })
  try {
    const lines = await app.waitFor((lines) => shows(lines, "github", "typescript", ...location))
    const rows = ["MCP", "LSP", ...location].map((text) => lines.findIndex((line) => line.includes(text)))

    expect(rows.every((row) => row >= 0)).toBe(true)
    expect(rows).toEqual([...rows].sort((a, b) => a - b))
    // Nothing but the sidebar's bottom padding below the branch line.
    expect(lines.slice(rows.at(-1)! + 1).every((line) => line.trim() === "")).toBe(true)
    expect(rows.at(-1)!).toBeGreaterThan(lines.length - 4)

    await app.close()
  } finally {
    app.destroy()
  }
}, 45_000)

test("a short terminal drops LSP and MCP before the location block", async () => {
  const app = await mountSidebar({ mcp, lsp, height: 40 })
  try {
    await app.waitFor((lines) => shows(lines, "MCP", "LSP", ...location))

    app.setup.resize(140, 14)
    const lines = await app.waitFor((lines) => !shows(lines, "MCP"))

    expect(shows(lines, "LSP")).toBe(false)
    expect(shows(lines, ...location)).toBe(true)

    await app.close()
  } finally {
    app.destroy()
  }
}, 45_000)

test("on a narrow terminal long worktree and branch names lose their middle but stay visible", async () => {
  const name = "sidebar-location-keeps-long-worktree-names-readable"
  const app = await mountSidebar({
    sessionDirectory: `${worktree}/.red/worktrees/${name}`,
    branch: name,
    width: 121,
    height: 30,
  })
  try {
    const lines = await app.waitFor((lines) => lines.some((line) => line.trim().startsWith("⑂ sidebar-")))
    const trimmed = lines.map((line) => line.trim())

    expect(trimmed).toContain(worktree)
    expect(trimmed.some((line) => /^⎇ \.red\/worktrees\/.*….*readable$/.test(line))).toBe(true)
    expect(trimmed.some((line) => /^⑂ sidebar-.*….*readable$/.test(line))).toBe(true)
    expect(lines.some((line) => line.includes(name))).toBe(false)

    await app.close()
  } finally {
    app.destroy()
  }
}, 45_000)

async function mountSidebar(input: {
  todos?: unknown[]
  mcp?: Record<string, unknown>
  lsp?: unknown[]
  sessionDirectory?: string
  branch?: string
  width?: number
  height?: number
}) {
  const session = {
    id: "session-sidebar",
    title: "Sidebar session",
    slug: "sidebar-session",
    projectID: "proj_test",
    directory: input.sessionDirectory ?? directory,
    version: "0.0.0-test",
    time: { created: 0, updated: 0 },
  }
  const setup = await createTestRenderer({ width: input.width ?? 140, height: input.height ?? 40, useThread: false })
  const core = await import("@opentui/core")
  void mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const calls = createFetch((url) => {
    if (url.pathname === "/redskilled") return json({}, { status: 404 })
    if (url.pathname === "/session") return json([session])
    if (url.pathname === `/session/${session.id}`) return json(session)
    if (url.pathname === `/session/${session.id}/todo`) return json(input.todos ?? [])
    if (url.pathname === `/session/${session.id}/message`) return json([])
    if (url.pathname === `/session/${session.id}/diff`) return json([])
    if (url.pathname === "/mcp") return json(input.mcp ?? {})
    if (url.pathname === "/lsp") return json(input.lsp ?? [])
    if (url.pathname === "/vcs") return json({ branch: input.branch ?? "main" })
    return undefined
  })
  const ready = Promise.withResolvers<TuiPluginApi>()

  const { run } = await import("../../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch: calls.fetch,
      events: createEventSource().source,
      args: {},
      pluginHost: {
        async start(started) {
          ready.resolve(started.api)
        },
        async dispose() {},
      },
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
  )

  const api = await ready.promise
  api.ui.dialog.clear()
  // The first-run card shares the footer slot; these tests are about the location lines under it.
  api.kv.set("dismissed_getting_started", true)
  api.route.navigate("session", { sessionID: session.id })
  await setup.renderOnce()

  /** The rendered rows of the session sidebar, cut to its own columns. */
  const sidebar = async () => {
    await setup.renderOnce()
    const box = setup.renderer.root.findDescendantById("session-sidebar")
    if (!box) return []
    return setup
      .captureCharFrame()
      .split("\n")
      .slice(box.screenY, box.screenY + box.height)
      .map((line) => line.slice(box.screenX, box.screenX + box.width))
  }

  return {
    setup,
    async waitFor(done: (lines: string[]) => boolean, timeout = 15_000) {
      const start = Date.now()
      while (!done(await sidebar())) {
        if (Date.now() - start > timeout) {
          throw new Error(`timed out waiting for the sidebar\n${setup.captureCharFrame()}`)
        }
        await Bun.sleep(20)
      }
      return sidebar()
    },
    async close() {
      api.keymap.dispatchCommand("app.exit")
      await task
    },
    destroy() {
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    },
  }
}
