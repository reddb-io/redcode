/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import assert from "node:assert/strict"
import path from "node:path"
import { chromium } from "playwright-core"
import { Schema } from "effect"
import { Design } from "@opencode/schema/design"
import { DesignPage } from "@opencode/core/design/ui/page"
import { tmpdir } from "../test/fixture/tmpdir"

// Exercise the serialized production shell and sandbox runtimes through a real local HTTP server.
await using directory = await tmpdir("redcode-design-browser-")
const design = Schema.decodeUnknownSync(Design.Info)({
  id: "design_profile",
  sessionID: "ses_browser",
  name: "Profile",
  journey: "new",
  engine: "html",
  kind: "screen",
  target: "web",
  root: directory.path,
  application: directory.path,
  entry: "index.html",
  brief: { objective: "Profile", audience: "", content: "", constraints: "", references: [] },
  decisions: [],
  questions: [],
  scenarios: [],
  designSystem: "",
  sources: [],
  tweaks: {},
  revision: "rev_latest",
  approvedRevision: null,
  ended: false,
  updated: 1,
})
const revisions = ["rev_latest", "rev_older"].map((id) =>
  Schema.decodeUnknownSync(Design.Revision)({
    id,
    designID: design.id,
    parent: null,
    name: id,
    created: 1,
    files: {},
    document: design,
  }),
)
await Bun.write(
  path.join(directory.path, "index.html"),
  `<!doctype html><html><body>
  <main data-design-variant="one"><section data-design-screen="profile"><button id="counter">Clicks: 0</button></section></main>
  <script>let count = 0; document.getElementById('counter').onclick = () => {
    document.getElementById('counter').textContent = 'Clicks: ' + (++count);
  }; document.body.insertAdjacentHTML('beforeend', '<main data-design-variant="two"><section data-design-screen="settings">Settings</section></main>');</script>
  </body></html>`,
)
const html = await DesignPage.preview(revisions[0]!, directory.path)
const jobs = Array.from({ length: 300 }, (_, index) =>
  Schema.decodeUnknownSync(Design.Job)({
    id: `job_${index}`,
    designID: design.id,
    input: { revision: "rev_latest", format: "audit" },
    status: "completed",
    progress: 1,
    result: null,
    error: null,
    created: index,
    audit: { revision: "rev_latest", findings: [`Finding ${index}`], scenarios: [], widths: [1024] },
  }),
)
const endpoint = "/api/session/ses_browser/design"
const state = {
  document: design,
  revisions,
  jobs,
  calls: [] as string[],
  feed: undefined as ReadableStreamDefaultController<Uint8Array> | undefined,
  hold: undefined as ReturnType<typeof Promise.withResolvers<void>> | undefined,
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const route = new URL(request.url).pathname
    state.calls.push(`${request.method} ${route}`)
    if (route === "/")
      return new Response(DesignPage.review("ses_browser", endpoint), { headers: { "content-type": "text/html" } })
    if (route === `${endpoint}/feed`)
      return new Response(
        new ReadableStream({
          start(controller) {
            state.feed = controller
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    if (route === endpoint) {
      await state.hold?.promise
      return Response.json([state.document])
    }
    if (route === `${endpoint}/${design.id}/revision`) return Response.json(state.revisions)
    if (route.endsWith("/preview")) return new Response(html, { headers: { "content-type": "text/html" } })
    if (route.endsWith("/status")) return Response.json({ stage: "ready" })
    if (route.endsWith("/job")) return Response.json(state.jobs)
    if (route.endsWith("/asset") || route.endsWith("/feedback")) return Response.json([])
    return new Response("Unknown fixture route", { status: 404 })
  },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.clock.install()
  await page.goto(`http://127.0.0.1:${server.port}`)
  await page.waitForFunction(() => {
    const root = document.querySelector("#review")?.shadowRoot
    return (
      root?.querySelector("#jobs")?.children.length === 300 &&
      !root.querySelector<HTMLSelectElement>("#revisions")?.disabled
    )
  })
  const preview = page.frameLocator("#preview")
  await preview.locator("#counter").click()
  assert.equal(await preview.locator("#counter").textContent(), "Clicks: 1")
  await page.evaluate(() => {
    const root = document.querySelector("#review")!.shadowRoot!
    const select = root.querySelector("#revisions")!
    select.setAttribute("data-mutations", "0")
    new MutationObserver((events) => {
      select.setAttribute("data-mutations", String(Number(select.getAttribute("data-mutations")) + events.length))
    }).observe(select, { childList: true })
    const jobs = root.querySelector("#jobs")!
    jobs.setAttribute("data-mutations", "0")
    new MutationObserver((events) => {
      jobs.setAttribute("data-mutations", String(Number(jobs.getAttribute("data-mutations")) + events.length))
    }).observe(jobs, { childList: true })
    root.querySelector<HTMLDetailsElement>("#jobs details")!.open = true
    const frame = root.querySelector("#preview")!
    frame.setAttribute("data-loads", "0")
    frame.addEventListener("load", () =>
      frame.setAttribute("data-loads", String(Number(frame.getAttribute("data-loads")) + 1)),
    )
  })
  const requests = (suffix: string) => state.calls.filter((call) => call === `GET ${endpoint}${suffix}`).length
  const settled = requests(`/${design.id}/job`)
  const revisionRequests = requests(`/${design.id}/revision`)
  const previewRequests = state.calls.filter((call) => call.endsWith("/preview")).length
  const refreshed = page.waitForResponse((response) => response.url().endsWith("/job"))
  await page.clock.runFor(5000)
  // Wait for the whole refresh, rather than just the first HTTP request.
  await refreshed
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  assert.equal(requests(`/${design.id}/job`), settled + 1)
  assert.equal(requests(`/${design.id}/revision`), revisionRequests)
  assert.equal(state.calls.filter((call) => call.endsWith("/preview")).length, previewRequests)
  const idlePickerMutations = Number(await page.locator("#revisions").getAttribute("data-mutations"))
  const idleJobMutations = Number(await page.locator("#jobs").getAttribute("data-mutations"))
  const idlePreviewReloads = Number(await page.locator("#preview").getAttribute("data-loads"))
  const idleRevisionRequests = requests(`/${design.id}/revision`) - revisionRequests
  assert.equal(idlePickerMutations, 0)
  assert.equal(idleJobMutations, 0)
  assert.equal(idlePreviewReloads, 0)
  assert.equal(
    await page
      .locator("#jobs details")
      .first()
      .evaluate((node) => node instanceof HTMLDetailsElement && node.open),
    true,
  )
  assert.equal(await preview.locator("#counter").textContent(), "Clicks: 1")

  // A single SSE chunk delivers many publication notifications while the first GET is stalled.
  state.hold = Promise.withResolvers<void>()
  const beforeBurst = requests("")
  const burst = Array.from(
    { length: 50 },
    (_, index) =>
      `data: ${JSON.stringify({
        type: "published",
        seq: index + 1,
        at: index,
        design: design.id,
        revision: "rev_new",
        name: "New",
      })}\n\n`,
  ).join("")
  assert.ok(state.feed)
  const refreshStarted = page.waitForRequest((request) => new URL(request.url()).pathname === endpoint)
  state.feed.enqueue(new TextEncoder().encode(burst))
  await refreshStarted
  await page.locator("#revisions").selectOption("rev_older")
  const hold = state.hold
  state.hold = undefined
  hold.resolve()
  await page.waitForFunction(() => {
    const select = document.querySelector("#review")!.shadowRoot!.querySelector<HTMLSelectElement>("#revisions")!
    return select.value === "rev_older" && !select.disabled
  })
  const burstRefreshes = requests("") - beforeBurst
  assert.equal(burstRefreshes, 1)
  assert.equal(await page.locator("#revisions").inputValue(), "rev_older")
  await preview.locator("#counter").click()
  assert.equal(await preview.locator("#counter").textContent(), "Clicks: 1")

  // New publications are offered while the reader browses history; they never replace it.
  state.document = { ...design, revision: "rev_new", updated: 2 }
  state.revisions = [{ ...revisions[0]!, id: "rev_new" }, ...revisions]
  await page.clock.runFor(5000)
  await page.waitForFunction(() => {
    const select = document.querySelector("#review")!.shadowRoot!.querySelector<HTMLSelectElement>("#revisions")!
    return select.options.length === 3 && select.value === "rev_older"
  })
  await page.locator("#revisions").selectOption("rev_new")
  await page.waitForFunction(
    () => !document.querySelector("#review")!.shadowRoot!.querySelector<HTMLSelectElement>("#revisions")!.disabled,
  )
  const start = performance.now()
  await preview.locator("#counter").click()
  const interactionMs = Math.round(performance.now() - start)
  assert.equal(await preview.locator("#counter").textContent(), "Clicks: 1")
  assert.ok(interactionMs < 2000, `Prototype click took ${interactionMs}ms`)
  assert.deepEqual(errors, [])
  assert.equal(state.calls.filter((call) => call.startsWith("POST ")).length, 0)
  console.log(
    JSON.stringify({
      jobs: jobs.length,
      publicationEvents: 50,
      burstRefreshes,
      idleRevisionRequests,
      idlePreviewReloads,
      idlePickerMutations,
      idleJobMutations,
      interactionMs,
      browserErrors: errors.length,
      automaticPublications: 0,
    }),
  )
} finally {
  await browser.close()
  await server.stop(true)
}
