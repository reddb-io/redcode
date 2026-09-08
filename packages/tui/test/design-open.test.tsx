import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import { InputRenderable } from "@opentui/core"
import { wait } from "./cli/cmd/tui/sync-fixture"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { Global } from "@reddb-io/redcode-core/global"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

test("design-open searches prototypes and resumes their existing conversation", async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const ready = Promise.withResolvers<TuiPluginApi>()
  const sessions = [
    {
      id: "ses_original",
      title: "Original session",
      slug: "original",
      projectID: "proj_test",
      directory,
      version: "0.0.0-test",
      time: { created: 0, updated: 0 },
    },
  ]
  sessions.push({ ...sessions[0]!, id: "ses_design", title: "Admin redesign" })
  let response: "designs" | "empty" | "error" = "designs"
  const requests: string[] = []
  const calls = createFetch((url) => {
    requests.push(url.pathname)
    if (url.pathname === "/design/list") {
      expect(url.searchParams.get("directory")).toBe(directory)
      if (response === "empty") return json([])
      if (response === "error") return json({}, { status: 503 })
      return json([
        { sessionID: "ses_original", title: "Unfinished exploration", updated: 0, designs: [] },
        {
          sessionID: "ses_design",
          title: "Admin redesign",
          updated: 1,
          designs: [{ id: "design_fixture", name: "Dark mode", revision: null, approvedRevision: null, ended: false }],
        },
      ])
    }
    if (url.pathname === "/session") return json(sessions)
    const session = sessions.find((item) => url.pathname === `/session/${item.id}`)
    if (session) return json(session)
    if (/^\/session\/[^/]+\/(message|todo|diff)$/.test(url.pathname)) return json([])
  })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch: calls.fetch,
      events: createEventSource().source,
      args: { sessionID: "ses_original" },
      pluginHost: {
        async start(input) {
          ready.resolve(input.api)
        },
        async dispose() {},
      },
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
  )
  async function frame(text: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      await setup.renderOnce()
      if (setup.captureCharFrame().includes(text)) return
      await Bun.sleep(10)
    }
    throw new Error(`Expected frame to contain ${text}: ${setup.captureCharFrame()}`)
  }
  try {
    const api = await ready.promise
    await setup.renderOnce()
    expect(api.keymap.getCommands().find((command) => command.name === "design.open")).toMatchObject({
      slashName: "design-open",
    })
    api.keymap.dispatchCommand("design.open")
    await frame("Dark mode")
    expect(setup.captureCharFrame()).toContain("Resume Design")
    expect(setup.captureCharFrame()).toContain("Draft")
    expect(setup.captureCharFrame()).toContain("Not started")
    const input = setup.renderer.currentFocusedEditor
    if (!(input instanceof InputRenderable)) throw new Error("Design search not focused")
    input.value = "missing design"
    await frame("No matching designs")
    input.value = "admin"
    await frame("Dark mode")
    setup.mockInput.pressEnter()
    await wait(() => {
      const route = api.route.current
      return "params" in route && route.params?.sessionID === "ses_design"
    })
    await setup.renderOnce()
    expect(api.route.current).toMatchObject({ name: "session", params: { sessionID: "ses_design" } })
    expect(requests).not.toContain("/session/ses_design/prompt_async")
    expect(sessions).toHaveLength(2)
    response = "empty"
    api.keymap.dispatchCommand("design.open")
    await frame("No designs in this workspace")
    setup.mockInput.pressKey("escape")
    await setup.renderOnce()
    response = "error"
    api.keymap.dispatchCommand("design.open")
    await frame("Could not load Design conversations (503)")
  } finally {
    const api = await ready.promise
    api.keymap.dispatchCommand("app.exit")
    await task
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}, 30000)
