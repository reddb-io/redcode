import { expect, test } from "@playwright/test"
import { Browser } from "../../../plugin-browser/src/rpc"
import type { Cdp } from "../../../gui-extensions/src/browser/cdp"
import { createDiagnostics } from "../../../gui-extensions/src/browser/diagnostics"

test("browser diagnostics retain console and exception text without retaining page objects", async ({
  page,
  context,
}) => {
  const session = await context.newCDPSession(page)
  // The production diagnostics run against Chromium's real protocol, without an Electron mock.
  // SAFETY: Playwright and Electron version their CDP types independently. Diagnostics uses
  // commands/events common to both; this test executes those commands against real Chromium.
  const cdp: Cdp = {
    send: session.send.bind(session) as Cdp["send"],
    on(method, callback) {
      const receive = (event: { method: string; params?: unknown }) => {
        // SAFETY: the method discriminator identifies the CDP payload supplied by Chromium.
        if (event.method === method) callback(event.params as Parameters<typeof callback>[0])
      }
      session.on("event", receive)
      return () => session.off("event", receive)
    },
    dispose: () => void session.detach(),
  }
  const diagnostics = createDiagnostics(cdp)
  const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
  await diagnostics.enable()
  for (const input of [
    {
      level: "info",
      expression: 'for (let i = 0; i < 80; i++) console.log("retention-check", {data: Array(100000).fill(i)})',
    },
    {
      level: "error",
      expression:
        'for (let i = 0; i < 80; i++) queueMicrotask(() => { throw new Error("retention-check", {cause: Array(100000).fill(i)}) })',
    },
  ]) {
    diagnostics.clear()
    await session.send("HeapProfiler.collectGarbage")
    const before = await session.send("Runtime.getHeapUsage")
    await session.send("Runtime.evaluate", { expression: input.expression })
    await expect.poll(() => diagnostics.console({ type: "console", tabID, limit: 100 }).messages.length).toBe(80)
    await expect
      .poll(async () => {
        await session.send("HeapProfiler.collectGarbage")
        return (await session.send("Runtime.getHeapUsage")).usedSize - before.usedSize
      })
      .toBeLessThan(4 * 1024 * 1024)
    expect(
      diagnostics
        .console({ type: "console", tabID, limit: 100 })
        .messages.every((entry) => entry.level === input.level && entry.text.includes("retention-check")),
    ).toBe(true)
  }
})
