import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each([
  { supported: true, kind: "interval", cancel: false },
  { supported: false, kind: "interval", cancel: false },
  { supported: true, kind: "once", cancel: false },
  { supported: true, kind: "weekly", cancel: false },
  { supported: true, kind: "interval", cancel: true },
] as const)(
  "/automation reviews its conditional request ($kind, supported: $supported, cancel: $cancel)",
  async ({ supported, kind, cancel }) => {
    await using state = await tmpdir()
    const setup = await createTestRenderer({ width: 110, height: 32, useThread: false, kittyKeyboard: true })
    setup.renderer.start()
    const sessionID = "ses_automation_tui"
    let input: Record<string, unknown> | undefined
    const attempts: Record<string, unknown>[] = []
    const calls = createFetch(async (url, request) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            projectID: "project",
            title: "Automation fixture",
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
      if (["inbox", "permission", "todo"].some((part) => url.pathname === `/api/session/${sessionID}/${part}`))
        return json({ data: [] })
      if (url.pathname === `/api/session/${sessionID}/automation/conditional` && request.method === "POST") {
        input = (await request.json()) as Record<string, unknown>
        attempts.push(input)
        if (!supported) return json({ message: "Not found" }, { status: 404 })
        return json({
          data: {
            ...input,
            sessionID,
            enabled: true,
            nextAt: Date.now() + 600_000,
            created: Date.now(),
            updated: Date.now(),
          },
        })
      }
      return undefined
    }, createEventStream())
    const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({ animations: false }), update: async () => ({}) },
        packages: { prepare: async () => ({ directory: "" }) },
        args: { sessionID },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
        log: () => {},
      }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
    )
    try {
      await setup.waitForFrame((frame) => frame.includes("commands"))
      await setup.mockInput.typeText("/automation")
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes("Automation name"))
      await setup.mockInput.typeText("Health check")
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes("Prompt to queue"))
      await setup.mockInput.typeText("Inspect service")
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes("Repeat at an interval"))
      if (kind !== "interval") setup.mockInput.pressArrow("down")
      if (kind === "weekly") setup.mockInput.pressArrow("down")
      setup.mockInput.pressEnter()
      let expectedSchedule: Record<string, unknown>
      if (kind === "interval") {
        await setup.waitForFrame((frame) => frame.includes("Check interval"))
        await setup.mockInput.typeText("10")
        setup.mockInput.pressEnter()
        expectedSchedule = { type: "interval", everyMs: 600_000 }
      } else if (kind === "once") {
        await setup.waitForFrame((frame) => frame.includes("Execution time with UTC offset"))
        const at = new Date(Date.now() + 3_600_000).toISOString()
        await setup.mockInput.typeText(at)
        setup.mockInput.pressEnter()
        expectedSchedule = { type: "once", at: Date.parse(at) }
      } else {
        await setup.waitForFrame((frame) => frame.includes("Time of day"))
        await setup.mockInput.typeText("09:00")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Named time zone"))
        await setup.mockInput.typeText("America/Sao_Paulo")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Weekdays"))
        await setup.mockInput.typeText("1,3,5")
        setup.mockInput.pressEnter()
        expectedSchedule = {
          type: "fixed_time",
          timeOfDay: "09:00",
          timeZone: "America/Sao_Paulo",
          weekdays: [1, 3, 5],
        }
      }
      await setup.waitForFrame((frame) => frame.includes("HTTP endpoint"))
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes("HTTP or HTTPS URL"))
      await setup.mockInput.typeText("https://example.com/health")
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes("Trigger when"))
      setup.mockInput.pressEnter()
      if (kind !== "once") {
        await setup.waitForFrame((frame) => frame.includes("When to run"))
        setup.mockInput.pressArrow("down")
        setup.mockInput.pressEnter()
      }
      await setup.waitForFrame((frame) => frame.includes("Create “Health check”"))
      expect(input).toBeUndefined()
      if (cancel) {
        setup.mockInput.pressArrow("down")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => !frame.includes("Create “Health check”"))
        expect(attempts).toHaveLength(0)
        return
      }
      setup.mockInput.pressEnter()
      if (supported) await setup.waitForFrame((frame) => frame.includes("Conditional automation created"))
      else {
        await setup.waitForFrame((frame) => frame.includes("Creation failed"))
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Creation failed") && attempts.length === 2)
        expect(attempts[0]?.id).toBe(attempts[1]?.id)
        setup.mockInput.pressArrow("down")
        setup.mockInput.pressEnter()
      }
      expect(input).toMatchObject({
        title: "Health check",
        prompt: "Inspect service",
        schedule: expectedSchedule,
        condition: {
          probe: { type: "http", url: "https://example.com/health" },
          when: "matches",
          mode: kind === "once" ? "on_match" : "on_change",
        },
      })
    } finally {
      setup.renderer.destroy()
      await task
      await server.stop(true)
    }
  },
  30_000,
)
