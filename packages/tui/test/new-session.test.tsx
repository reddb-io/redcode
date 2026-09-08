import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { Global } from "@reddb-io/redcode-core/global"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

test("new and clear open fresh sessions without returning to the welcome screen", async () => {
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
  const calls = createFetch((url) => {
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
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init)
          if (request.method === "POST" && new URL(request.url).pathname === "/session") {
            const session = { ...sessions[0]!, id: `ses_new_${sessions.length}`, title: "New session" }
            sessions.push(session)
            return json(session)
          }
          return calls.fetch(input, init)
        },
        { preconnect: fetch.preconnect },
      ),
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
  try {
    const api = await ready.promise
    await setup.renderOnce()
    expect(api.route.current.name).toBe("session")
    expect(api.keymap.getCommands().find((command) => command.name === "session.new")).toMatchObject({
      slashName: "new",
      slashAliases: ["clear"],
    })
    for (const id of ["ses_new_1", "ses_new_2"]) {
      api.keymap.dispatchCommand("session.new")
      for (let attempt = 0; attempt < 50; attempt++) {
        const route = api.route.current
        if ("params" in route && route.params?.sessionID === id) break
        await Bun.sleep(10)
        await setup.renderOnce()
      }
      expect(api.route.current).toMatchObject({ name: "session", params: { sessionID: id } })
      await setup.renderOnce()
      expect(setup.captureCharFrame()).not.toMatch(/[█▀▄]/)
    }
    expect(sessions[0]?.id).toBe("ses_original")
    expect(sessions).toHaveLength(3)
  } finally {
    const api = await ready.promise
    api.keymap.dispatchCommand("app.exit")
    await task
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}, 30000)
