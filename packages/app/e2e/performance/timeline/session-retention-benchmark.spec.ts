import { benchmark, expect } from "../benchmark"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { fixture, installStressSessionTabs } from "../../utils/session-fixture"
import { expectSessionTitle } from "../../utils/waits"
import { sessionHref } from "../../utils/app"
import { messages } from "../../utils/markdown-sessions"
import { waitForStableTimeline } from "./session-tab-switch-probe"

const sessions = Array.from({ length: 8 }, (_, index) => ({
  ...fixture.sessions[0],
  id: `ses_retention_${index}`,
  title: `Retention session ${index}`,
}))
const pages = Object.fromEntries(
  sessions.map((session) => [
    session.id,
    messages[fixture.targetID].slice(-20).map((message) => ({ ...message, id: `${message.id}_${session.id}` })),
  ]),
)

benchmark.use({ viewport: { width: 1440, height: 900 }, video: "off", trace: "off", serviceWorkers: "block" })

benchmark("retains renderer memory after visiting and closing session tabs", async ({ page, report }) => {
  const reads: string[] = []
  await mockOpenCodeServer(page, {
    ...fixture,
    sessions,
    pageMessages: (id) => ({ items: pages[id] ?? [] }),
    onMessages: ({ sessionID, phase }) => { if (phase === "start") reads.push(sessionID) },
  })
  await installStressSessionTabs(page, { sessionIDs: sessions.map((session) => session.id) })
  const cdp = await page.context().newCDPSession(page)
  await page.goto(sessionHref(sessions[0]!.id))
  await expectSessionTitle(page, sessions[0]!.title)
  await waitForStableTimeline(page, pages[sessions[0]!.id].at(-2)!.id)
  const sample = async () => {
    await cdp.send("HeapProfiler.collectGarbage")
    const heap = await cdp.send("Runtime.getHeapUsage")
    const nodes = await cdp.send("Memory.getDOMCounters")
    return { usedBytes: heap.usedSize, nodes: nodes.nodes, documents: nodes.documents }
  }
  const initial = await sample()
  for (const session of sessions.slice(1)) {
    await page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(session.id)}"]`).click()
    await expectSessionTitle(page, session.title)
    await waitForStableTimeline(page, pages[session.id].at(-2)!.id)
  }
  const visited = await sample()
  await page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(sessions[0]!.id)}"]`).click()
  await expectSessionTitle(page, sessions[0]!.title)
  for (const session of sessions.slice(1)) {
    const tab = page.locator("[data-titlebar-tab-slot]").filter({ has: page.locator(`a[href="${sessionHref(session.id)}"]`) })
    await tab.getByRole("button", { name: "Close tab", exact: true }).click()
    await expect(tab).toHaveCount(0)
  }
  const closed = await sample()
  await cdp.detach()
  expect(reads).toContain(sessions[7]!.id)
  report({ initial, visited, closed, reads: reads.length }, {
    sessions: sessions.length,
    messagesPerSession: 20,
    source: "routed synthetic transcript",
    gc: "forced before each sample; renderer main isolate and DOM only",
  })
})
