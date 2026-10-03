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
  todos: [
    {
      id: "todo_profile",
      phase: "design",
      title: "Refine profile",
      content: "Refine profile and verify",
      status: "in_progress",
      priority: "high",
    },
  ],
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
    if (route === `${endpoint}/todo`) return Response.json(state.todos)
    if (route === `${endpoint}/share`)
      return Response.json({ url: "http://192.168.1.10:35555/design/session/ses_browser/review?ticket=fixture" })
    if (route === endpoint) {
      await state.hold?.promise
      return Response.json([state.document])
    }
    if (route === `${endpoint}/${design.id}/approve` && request.method === "POST") {
      state.document = { ...state.document, approvedRevision: state.document.revision, ended: true }
      return Response.json({ agent: "plan" })
    }
    if (route === `${endpoint}/${design.id}/revision`) return Response.json(state.revisions)
    if (route.endsWith("/preview"))
      return new Response(
        html.replace("Clicks: 0", route.includes("/rev_deferred/") ? "Updated profile" : "Clicks: 0"),
        {
          headers: { "content-type": "text/html" },
        },
      )
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

  // The end-of-round review is visible only for a live job on the latest revision.
  const refreshJobs = async () => {
    const response = page.waitForResponse((response) => response.url().endsWith("/job"))
    await page.clock.runFor(5000)
    await response
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  }
  const reviewing = { ...jobs[0]!, id: "job_live_review", status: "running" as const, progress: 0.5, audit: undefined }
  state.jobs = [...jobs, reviewing]
  await refreshJobs()
  assert.equal(await page.locator("#agent-state").textContent(), "Applying anti-slop…")
  assert.ok((await page.locator("#jobs").textContent())?.includes("Applying anti-slop… (audit) · running · 50%"))
  state.jobs = [...jobs, { ...reviewing, status: "completed", progress: 1 }]
  await refreshJobs()
  assert.equal(await page.locator("#agent-state").textContent(), "Idle")
  state.jobs = [...jobs, { ...reviewing, input: { ...reviewing.input, revision: "rev_older" } }]
  await refreshJobs()
  assert.equal(await page.locator("#agent-state").textContent(), "Idle")
  state.jobs = [...jobs, { ...reviewing, status: "failed", error: "Renderer stopped" }]
  await refreshJobs()
  assert.equal(await page.locator("#agent-state").textContent(), "Idle")
  assert.equal(state.calls.filter((call) => call.endsWith("/preview")).length, previewRequests)
  assert.equal(await preview.locator("#counter").textContent(), "Clicks: 1")
  state.jobs = jobs

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

  // Publishing while the iframe has focus defers the reload; the next idle poll must still follow latest.
  state.document = { ...state.document, revision: "rev_deferred", updated: 3 }
  state.revisions = [{ ...revisions[0]!, id: "rev_deferred" }, ...state.revisions]
  state.todos = [{ ...state.todos[0]!, status: "completed" }]
  const deferred = page.waitForResponse((response) => response.url().endsWith("/job"))
  await page.clock.runFor(5000)
  await deferred
  await page.waitForFunction(() => {
    const select = document.querySelector("#review")!.shadowRoot!.querySelector<HTMLSelectElement>("#revisions")!
    return select.options.length === 4 && select.value === "rev_new" && !select.disabled
  })
  assert.equal(await preview.locator("#counter").textContent(), "Clicks: 1")
  await page.evaluate(() => {
    const root = document.querySelector("#review")!.shadowRoot!
    root.querySelector<HTMLIFrameElement>("#preview")!.blur()
  })
  await page.clock.runFor(5000)
  await page.waitForFunction(() => {
    const select = document.querySelector("#review")!.shadowRoot!.querySelector<HTMLSelectElement>("#revisions")!
    return select.value === "rev_deferred" && !select.disabled
  })
  await preview.locator("#counter").filter({ hasText: "Updated profile" }).waitFor()
  assert.equal(await preview.locator("#counter").textContent(), "Updated profile")
  const deferredPreviewUpdated = true
  assert.equal(await page.locator('[data-task="todo_profile"]').getAttribute("data-status"), "completed")
  await page.locator("#more").click()
  await page.locator("#share").click()
  await page.waitForFunction(
    () => !!document.querySelector("#review")?.shadowRoot?.querySelector("dialog[open] input[readonly]"),
  )
  assert.match(await page.locator("dialog[open] input[readonly]").inputValue(), /192\.168\.1\.10:35555/)
  await page.locator("dialog[open] button").click()
  assert.deepEqual(errors, [])
  assert.equal(state.calls.filter((call) => call.startsWith("POST ")).length, 0)
  // A CLI approval moves the live session to Plan; the open browser clears its prototype and feed.
  state.document = { ...state.document, approvedRevision: "rev_deferred", ended: true }
  state.feed.enqueue(
    new TextEncoder().encode(
      `data: ${JSON.stringify({
        type: "agent",
        seq: 51,
        at: 51,
        agent: "plan",
      })}\n\n`,
    ),
  )
  await page.waitForFunction(() => {
    const root = document.querySelector("#review")!.shadowRoot!
    return !root.querySelector("iframe") && root.textContent?.includes("Design approved")
  })
  const closedRequests = state.calls.length
  await page.clock.runFor(15000)
  assert.equal(state.calls.length, closedRequests, "Closed Design reviews must stop polling")
  const closedPreviewFrames = await page.locator("iframe").count()
  const closedPollingRequests = state.calls.length - closedRequests
  // Approval in the browser follows the same retirement path and completes its action cleanly.
  state.document = { ...state.document, approvedRevision: null, ended: false }
  await page.reload()
  await page.waitForFunction(() => {
    const root = document.querySelector("#review")!.shadowRoot!
    return !root.querySelector<HTMLButtonElement>("#approve")?.disabled && root.querySelector("iframe")
  })
  await page.locator("#approve").click()
  await page.locator("#confirm-approve").click()
  await page.waitForFunction(() => {
    const root = document.querySelector("#review")!.shadowRoot!
    return !root.querySelector("iframe") && root.textContent?.includes("Design approved")
  })
  const approvedRequests = state.calls.length
  await page.clock.runFor(15000)
  assert.equal(state.calls.length, approvedRequests, "Browser approval must stop polling")
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      jobs: jobs.length,
      publicationEvents: 50,
      burstRefreshes,
      idleRevisionRequests,
      idlePreviewReloads,
      idlePickerMutations,
      idleJobMutations,
      deferredPreviewUpdated,
      interactionMs,
      browserErrors: errors.length,
      automaticPublications: 0,
      closedPreviewFrames,
      closedPollingRequests,
      browserApprovalPollingRequests: state.calls.length - approvedRequests,
    }),
  )
} finally {
  await browser.close()
  await server.stop(true)
}
