/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import assert from "node:assert/strict"
import path from "node:path"
import { chromium } from "playwright-core"
import { Schema } from "effect"
import { PNG } from "pngjs"
import { DesignAssets } from "@opencode/core/design/assets"
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
  <script>var module = { exports: {} }; var exports = module.exports;</script>
  <main data-design-variant="one"><section data-design-screen="profile"><button id="counter">Clicks: 0</button><div id="capture-marker" style="position:fixed;left:40px;top:60px;width:80px;height:80px;background:#e00000"></div><textarea autocomplete="cc-name" style="position:fixed;left:200px;top:60px;width:200px;height:80px;border:0;background:#fff;color:#000;font:32px monospace">PRIVATE CARD NAME</textarea></section></main>
  <script>let count = 0; document.getElementById('counter').onclick = () => {
    document.getElementById('counter').textContent = 'Clicks: ' + (++count); document.getElementById('capture-marker').style.background = '#00c000';
  }; document.body.insertAdjacentHTML('beforeend', '<main data-design-variant="two"><section data-design-screen="settings">Settings</section></main>');</script>
  </body></html>`,
)
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
  failRevisions: false,
  failApproval: false,
  failFeedback: false,
  refused: undefined as string | undefined,
  /** The next review message is answered with a 409 conflict, which the page holds for a resend or a discard. */
  conflictFeedback: false,
  conflicted: undefined as string | undefined,
  /** The platforms the Details tab saved on the design. */
  platforms: [] as string[],
  assets: [] as Design.Asset[],
  captures: [] as Design.ImportAsset[],
  approvals: [] as Design.Approve[],
  feedback: [] as Design.Feedback[],
  feed: undefined as ReadableStreamDefaultController<Uint8Array> | undefined,
  /** The feed refuses connections, as a server that went away does. */
  feedDown: false,
  /** The server writes a heartbeat comment so the page's no-bytes watchdog sees a live connection. */
  heartbeat: true,
  hold: undefined as ReturnType<typeof Promise.withResolvers<void>> | undefined,
}
const heartbeats = setInterval(() => {
  if (!state.heartbeat) return
  try {
    state.feed?.enqueue(new TextEncoder().encode(": heartbeat\n\n"))
  } catch {
    // The page dropped this connection; the next one replaces it.
  }
}, 100)
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 60,
  async fetch(request) {
    const route = new URL(request.url).pathname
    state.calls.push(`${request.method} ${route}`)
    if (route === "/")
      return new Response(DesignPage.review("ses_browser", endpoint), { headers: { "content-type": "text/html" } })
    if (route === `${endpoint}/feed`) {
      if (state.feedDown) return new Response("Unavailable", { status: 503 })
      return new Response(
        new ReadableStream({
          start(controller) {
            state.feed = controller
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    }
    if (route === `${endpoint}/todo`) return Response.json(state.todos)
    if (route === `${endpoint}/share`)
      return Response.json({ url: "http://192.168.1.10:35555/design/session/ses_browser/review?ticket=fixture" })
    if (route === endpoint) {
      await state.hold?.promise
      return Response.json([state.document])
    }
    if (route === `${endpoint}/${design.id}/approve` && request.method === "POST") {
      state.approvals.push(Schema.decodeUnknownSync(Design.Approve)(await request.json()))
      if (state.failApproval) {
        state.failApproval = false
        return Response.json({ message: "Retry approval" }, { status: 503 })
      }
      state.document = { ...state.document, approvedRevision: state.document.revision, ended: true }
      return Response.json({ agent: "plan" })
    }
    // Reopening withdraws a pending end too, as the store does; Keep reviewing uses it.
    if (route === `${endpoint}/${design.id}/reopen` && request.method === "POST") {
      const { endRequested: _ending, ...reopened } = state.document
      state.document = { ...reopened, ended: false }
      return Response.json(state.document)
    }
    if (route === `${endpoint}/${design.id}` && request.method === "PATCH") {
      const patch = (await request.json()) as { platform?: string }
      state.platforms.push(patch.platform ?? "")
      state.document = Schema.decodeUnknownSync(Design.Info)({ ...state.document, ...patch })
      return Response.json(state.document)
    }
    if (route === `${endpoint}/${design.id}/revision`) {
      if (state.failRevisions) {
        state.failRevisions = false
        return Response.json({ message: "Revision list temporarily unavailable" }, { status: 503 })
      }
      return Response.json(state.revisions)
    }
    if (route.endsWith("/preview")) {
      const revision = state.revisions.find((revision) => route.includes(`/${revision.id}/`))!
      const html = await DesignPage.preview(revision, directory.path)
      return new Response(
        html.replace("Clicks: 0", route.includes("/rev_deferred/") ? "Updated profile" : "Clicks: 0"),
        { headers: { "content-type": "text/html" } },
      )
    }
    if (route.endsWith("/status")) return Response.json({ stage: "ready" })
    if (route.endsWith("/job")) return Response.json(state.jobs)
    if (route.endsWith("/asset")) {
      if (request.method === "GET") return Response.json(state.assets)
      const input = Schema.decodeUnknownSync(Design.ImportAsset)(await request.json())
      const bytes = DesignAssets.validate(input.data, input.mime)
      const asset = Design.Asset.make({
        id: `asset_${state.assets.length}`,
        designID: design.id,
        name: input.name,
        mime: input.mime,
        bytes: bytes.length,
        hash: "fixture",
        source: input.source,
        parent: null,
        created: Date.now(),
      })
      state.captures.push(input)
      state.assets.push(asset)
      return Response.json(asset)
    }
    if (route.endsWith("/file"))
      return new Response(Buffer.from(state.captures[0]!.data, "base64"), { headers: { "content-type": "image/png" } })
    if (route.endsWith("/feedback")) {
      if (request.method !== "POST") return Response.json([])
      const feedback = Schema.decodeUnknownSync(Design.Feedback)(await request.json())
      // The server's answer to a review it will not store, such as one too long for one message.
      if (state.failFeedback) {
        state.failFeedback = false
        state.refused = feedback.id
        return Response.json({ message: "This review is too long to send as one message" }, { status: 400 })
      }
      if (state.conflictFeedback) {
        state.conflictFeedback = false
        state.conflicted = feedback.id
        return Response.json({ message: "Reload the latest revision before sending" }, { status: 409 })
      }
      state.feedback.push(feedback)
      return Response.json([])
    }
    return new Response("Unknown fixture route", { status: 404 })
  },
})
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
try {
  // The review's slide frames are always 1920×1080, even when their host scales them down.
  // A padded deck must not turn that native-size frame into a scrolling document.
  await Bun.write(
    path.join(directory.path, "slides.html"),
    `<!doctype html><html><head><style>.deck{padding:24px}section.slide{background:lightblue}@media print{.deck{padding:0}}</style></head><body><main class="deck"><section class="slide" id="first"><h1>First slide</h1><aside class="notes">Speaker notes</aside></section><section class="slide" id="second"><h1>Second slide</h1></section></main></body></html>`,
  )
  const presentation = await DesignPage.preview(
    { ...revisions[0], document: { ...design, target: "presentation", entry: "slides.html" } },
    directory.path,
  )
  const slidePage = await browser.newPage()
  try {
    await slidePage.setViewportSize({ width: 1920, height: 1080 })
    await slidePage.goto(`data:text/html;base64,${Buffer.from(presentation).toString("base64")}`)
    await slidePage.waitForSelector("#first[data-design-screen]")
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1920, height: 1200 },
      { width: 1919, height: 1080 },
      { width: 1280, height: 800 },
      { width: 393, height: 852 },
    ]) {
      await slidePage.setViewportSize(viewport)
      await slidePage.waitForFunction(() => {
        const slide = document.querySelector("#first")!.getBoundingClientRect()
        const scale = Math.min(innerWidth / 1920, innerHeight / 1080)
        return (
          Math.abs(slide.width - 1920 * scale) < 0.1 &&
          Math.abs(slide.height - 1080 * scale) < 0.1 &&
          Math.abs(slide.x - (innerWidth - slide.width) / 2) < 0.1 &&
          Math.abs(slide.y - (innerHeight - slide.height) / 2) < 0.1
        )
      })
      assert.deepEqual(
        await slidePage.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
          overflow: getComputedStyle(document.documentElement).overflow,
        })),
        { ...viewport, overflow: "hidden" },
      )
    }
    await slidePage.keyboard.press("ArrowRight")
    await slidePage.waitForSelector("#second", { state: "visible" })
    assert.equal(await slidePage.locator("#first").isVisible(), false)
    assert.equal(await slidePage.locator("aside.notes").isVisible(), false)

    await slidePage.emulateMedia({ media: "print" })
    await slidePage.evaluate(() => window.dispatchEvent(new CustomEvent("design:print", { detail: { all: true } })))
    assert.equal(await slidePage.locator("section.slide:visible").count(), 2)
    assert.deepEqual(
      await slidePage.locator("#first").evaluate((node) => ({
        position: getComputedStyle(node).position,
        transform: getComputedStyle(node).transform,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      })),
      { position: "relative", transform: "none", width: 1920, height: 1080 },
    )
    assert.equal(
      (
        Buffer.from(await slidePage.pdf({ preferCSSPageSize: true }))
          .toString("latin1")
          .match(/\/Type\s*\/Page\b/g) ?? []
      ).length,
      2,
    )
    console.log(
      "Presentation fits without scrolling at native, near-native, desktop and mobile sizes; navigation and two-page PDF verified",
    )
  } finally {
    await slidePage.close()
  }
  const errors: string[] = []
  page.on("pageerror", (error) => {
    errors.push(error.message)
    console.error("Design browser error", error.message)
  })
  await page.addInitScript(() =>
    window.addEventListener("message", (event) => {
      if (event.data?.type === "design:capture-result" && event.data.error)
        console.error("Capture failed", event.data.reason)
    }),
  )
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text())
  })
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

  // The Feedback panel: the newest round is a checklist, a finished round is one line, the round's message and a
  // refused status recording come from the feed, and an idle poll leaves rows, expansion and a typed reason alone.
  const poll = async () => {
    const response = page.waitForResponse((response) => response.url().endsWith("/job"))
    await page.clock.runFor(5000)
    await response
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  }
  const item = (index: number) => ({
    target: `variant:one [data-design-id="item-${index}"]`,
    text: `Note ${index} words`,
    tag: "button",
    elementText: `Button ${index}`,
    label: `button "Button ${index}" in main`,
  })
  const note = (feedback: string, round: number, index: number, status: string, extra = {}) => ({
    feedback,
    index,
    round,
    item: item(round * 10 + index),
    status,
    updated: 1,
    ...extra,
  })
  const reviewed = (notes: unknown[], published?: string) =>
    Schema.decodeUnknownSync(Design.Info)({
      ...design,
      rounds: [
        { number: 1, opened: 1, revision: "rev_older", feedback: ["msg_first"], published: "rev_latest" },
        { number: 2, opened: 2, revision: "rev_latest", feedback: ["msg_second"], ...(published ? { published } : {}) },
      ],
      notes,
    })
  const settledRound = [note("msg_first", 1, 1, "resolved"), note("msg_first", 1, 2, "accepted", { reason: "Kept" })]
  state.document = reviewed([
    ...settledRound,
    note("msg_second", 2, 1, "open", { addressed: { summary: "Moved the header", at: 2 } }),
    note("msg_second", 2, 2, "open"),
    note("msg_second", 2, 3, "open"),
  ])
  state.feed!.enqueue(
    new TextEncoder().encode(
      [
        { type: "user", seq: 0, at: 1, id: "msg_second", text: "Tighten the header", notes: 3 },
        {
          type: "tool",
          seq: 0,
          at: 2,
          id: "call_record",
          tool: "design_document",
          status: "failed",
          summary: "Semantic evaluation unavailable",
        },
        { type: "reply", seq: 0, at: 3, id: "reply_second", text: "Done with **the header**, next `nav`." },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    ),
  )
  await poll()
  const panel = page.locator("#panel-review")
  assert.match((await page.locator("#tab-review").textContent()) ?? "", /^Feedback3$/)
  const rows = panel.locator('#rounds-list .rows[data-block="current"] > li')
  assert.equal(await rows.count(), 3)
  assert.equal(await rows.first().locator(".glyph").getAttribute("aria-label"), "Fixed, not verified yet")
  assert.equal(await panel.locator("details.round-done").count(), 1)
  assert.equal(await panel.locator("details.round-done").evaluate((node) => (node as HTMLDetailsElement).open), false)
  assert.match((await panel.locator("details.round-done summary").textContent()) ?? "", /Round 1.*2 notes/)
  assert.match((await page.locator("#round-alert").textContent()) ?? "", /^Status recording refused: Semantic/)
  assert.match((await page.locator("#round-message").textContent()) ?? "", /Tighten the header/)
  assert.equal(await rows.filter({ hasText: "Tighten the header" }).count(), 0, "The typed message is not a note")
  assert.equal(await page.locator("#reply-text strong").textContent(), "the header")
  assert.equal(await page.locator("#reply-text code").textContent(), "nav")
  assert.equal(await page.locator("#activity").evaluate((node) => (node as HTMLDetailsElement).open), false)
  const second = rows.nth(1)
  await second.locator('[data-part="toggle"]').click()
  assert.equal(await second.locator('[data-part="toggle"]').getAttribute("aria-expanded"), "true")
  await second.locator('[data-part="close"]').click()
  await second.locator('[data-part="reason"]').fill("Half typed")
  await page.evaluate(() => {
    const list = document.querySelector("#review")!.shadowRoot!.querySelector("#rounds-list")!
    list.setAttribute("data-mutations", "0")
    new MutationObserver((events) => {
      list.setAttribute("data-mutations", String(Number(list.getAttribute("data-mutations")) + events.length))
    }).observe(list, { childList: true, subtree: true })
  })
  await poll()
  const idleRoundMutations = Number(await page.locator("#rounds-list").getAttribute("data-mutations"))
  assert.equal(idleRoundMutations, 0)
  // A status recorded on another note rebuilds that row only; the typed reason keeps its row and its focus.
  state.document = reviewed([
    ...settledRound,
    note("msg_second", 2, 1, "resolved", { addressed: { summary: "Moved the header", at: 2 } }),
    note("msg_second", 2, 2, "open"),
    note("msg_second", 2, 3, "open"),
  ])
  await poll()
  assert.equal(await rows.first().getAttribute("data-status"), "resolved")
  assert.equal(await second.locator('[data-part="toggle"]').getAttribute("aria-expanded"), "true")
  assert.equal(await second.locator('[data-part="reason"]').inputValue(), "Half typed")
  assert.equal(
    await page.evaluate(
      () => (document.querySelector("#review")!.shadowRoot!.activeElement as HTMLElement | null)?.dataset.part,
    ),
    "reason",
  )
  assert.match((await page.locator("#tab-review").textContent()) ?? "", /^Feedback2$/)
  await panel.locator("#rounds-only").click()
  assert.equal(await rows.first().isVisible(), false)
  assert.match((await page.locator("#round-tally").textContent()) ?? "", /1 hidden/)
  await panel.locator("#rounds-only").click()

  // The round's progress line: received, fixing, stopped, published, verifying and ready, derived from the
  // document, the jobs and live feed events (sequence above 0); the revision chip and the line above the preview.
  // Both name the revision on screen first: its number counts from the oldest listed revision (rev_older is R1,
  // rev_latest R2), so it stays the same when newer revisions are listed.
  const live = (...events: object[]) =>
    state.feed!.enqueue(new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")))
  const shown = async (id: string, pattern: RegExp) => {
    await page
      .waitForFunction(
        ([id, source]) =>
          new RegExp(source).test(document.querySelector("#review")!.shadowRoot!.getElementById(id)?.textContent ?? ""),
        [id, pattern.source] as const,
        { timeout: 5000 },
      )
      .catch(() => undefined)
    assert.match((await page.locator(`#${id}`).textContent()) ?? "", pattern)
  }
  live({ type: "state", seq: 60, at: 60, state: "working" })
  live({ type: "user", seq: 61, at: 61, id: "msg_second", text: "Tighten the header", notes: 3, pending: true })
  await shown("round-stage", /^Received · waiting for the agent/)
  assert.equal(await page.locator("#round-steps").getAttribute("aria-label"), "Step 1 of 5: Received")
  await shown("newer-label", /^R2 · Latest$/)
  await shown("revision-line", /^R2 · This preview is from before round 2\.The agent has not taken the notes up yet\./)
  live({ type: "user", seq: 62, at: 62, id: "msg_second", text: "Tighten the header", notes: 3 })
  await shown("round-stage", /^Fixing · 1 of 3 addressed$/)
  await shown("revision-line", /The agent is working on 2 notes\./)
  live({ type: "tool", seq: 63, at: 63, id: "call_edit", tool: "edit", status: "running", summary: "index.html" })
  await shown("agent-text", /^Running edit · 0 s · index\.html$/)
  // A wait the feed reports (here a permission the terminal asks for) names itself, then hands the line back.
  live({ type: "wait", seq: 68, at: 63, wait: "permission", active: true, message: "edit index.html" })
  await shown("agent-text", /^Waiting for your approval in the terminal: edit index\.html$/)
  assert.equal(await page.locator("#agent-state").getAttribute("data-state"), "waiting")
  live({ type: "wait", seq: 69, at: 63, wait: "permission", active: false })
  await shown("agent-text", /^Running edit · \d+ s · index\.html$/)
  assert.equal(await page.locator("#agent-state").getAttribute("data-state"), "working")
  live({ type: "state", seq: 64, at: 64, state: "idle" })
  await page.clock.runFor(3000)
  await shown("round-stage", /^Stopped · 2 not addressed$/)
  await shown("revision-line", /The agent stopped with 2 notes not addressed\./)
  await shown("agent-text", /^Agent idle since /)
  const answeredNotes = [
    ...settledRound,
    note("msg_second", 2, 1, "resolved", { addressed: { summary: "Moved the header", at: 2 } }),
    note("msg_second", 2, 2, "open", { addressed: { summary: "Tightened the spacing", at: 3 } }),
    note("msg_second", 2, 3, "open", { addressed: { summary: "Shortened the label", at: 3 } }),
  ]
  state.document = reviewed(answeredNotes, "rev_latest")
  live(
    { type: "state", seq: 65, at: 65, state: "working" },
    { type: "published", seq: 66, at: 66, design: design.id, revision: "rev_latest", name: "rev_latest" },
  )
  await poll()
  await shown("round-stage", /^Published · not verified yet$/)
  await shown("revision-line", /^R2 · Latest, .+, answers round 2\.$/)
  await shown("newer-label", /^R2 · Latest$/)
  const verify = {
    ...jobs[0]!,
    id: "job_verify_round",
    input: { revision: "rev_latest", format: "verify" as const, round: 2 },
    status: "running" as const,
    progress: 0.4,
    audit: undefined,
    created: 400,
  }
  state.jobs = [...jobs, verify]
  await poll()
  await shown("round-stage", /^Verifying/)
  assert.equal(await page.locator("#round-steps").getAttribute("aria-label"), "Step 4 of 5: Verifying")
  state.jobs = [...jobs, { ...verify, status: "completed", progress: 1 }]
  state.document = reviewed(
    [
      ...settledRound,
      note("msg_second", 2, 1, "resolved"),
      note("msg_second", 2, 2, "resolved"),
      note("msg_second", 2, 3, "unresolved", { reason: "Needs a copy decision", by: "reviewer" }),
    ],
    "rev_latest",
  )
  live({ type: "state", seq: 67, at: 67, state: "idle" })
  await poll()
  await shown("round-stage", /^Ready for review · 2 marked resolved, 1 closed by you$/)
  assert.equal(await page.locator("#round-steps").getAttribute("aria-label"), "Step 5 of 5: Ready for review")
  assert.equal(await page.locator("#revision-line").getAttribute("data-tone"), "ok")
  // Send & end with notes leaves the end pending: the round says so, and Keep reviewing withdraws it.
  await shown("round-sub", /^Answered by revision R2$/)
  state.document = { ...state.document, endRequested: true }
  await poll()
  await shown("round-sub", /^Answered by revision R2Ending after this roundKeep reviewing$/)
  await page.locator('#round-sub [data-part="keep-reviewing"]').click()
  await shown("round-sub", /^Answered by revision R2$/)
  assert.equal(state.document.endRequested, undefined)
  assert.equal(state.calls.filter((call) => call === `POST ${endpoint}/${design.id}/reopen`).length, 1)
  const readyStage = await page.locator("#round-stage").textContent()
  // A dropped feed is noticed by its silence, shown, and replaced; nothing claims the review is ready meanwhile.
  state.heartbeat = false
  state.feedDown = true
  await page.clock.runFor(45000)
  await shown("newer-label", /^R2 · Offline$/)
  await shown("agent-text", /^Offline, retrying$/)
  assert.doesNotMatch((await page.locator("#round-stage").textContent()) ?? "", /^Ready/)
  state.feedDown = false
  state.heartbeat = true
  // The reconnect waits out its backoff; each attempt is a real request between steps of the fake clock.
  for (
    let attempt = 0;
    attempt < 10 && (await page.locator("#newer-label").textContent()) !== "R2 · Latest";
    attempt++
  ) {
    await page.clock.runFor(4000)
    await page.waitForTimeout(250)
  }
  await shown("newer-label", /^R2 · Latest$/)
  await shown("agent-text", /^Agent idle/)
  state.jobs = jobs
  state.document = design
  await poll()
  assert.equal(await page.locator("#rounds").isHidden(), true)

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
  assert.match((await page.locator("#agent-state").textContent()) ?? "", /^Agent idle/)
  state.jobs = [...jobs, { ...reviewing, input: { ...reviewing.input, revision: "rev_older" } }]
  await refreshJobs()
  assert.match((await page.locator("#agent-state").textContent()) ?? "", /^Agent idle/)
  state.jobs = [...jobs, { ...reviewing, status: "failed", error: "Renderer stopped" }]
  await refreshJobs()
  assert.match((await page.locator("#agent-state").textContent()) ?? "", /^Agent idle/)
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
  await shown("newer-label", /^R1 · 2 behind$/)
  await shown("revision-line", /^R1 · An older revision, from /)
  await page.locator("#revisions").selectOption("rev_new")
  await page.waitForFunction(
    () => !document.querySelector("#review")!.shadowRoot!.querySelector<HTMLSelectElement>("#revisions")!.disabled,
  )
  const start = performance.now()
  await preview.locator("#counter").click()
  const interactionMs = Math.round(performance.now() - start)
  assert.equal(await preview.locator("#counter").textContent(), "Clicks: 1")
  assert.ok(interactionMs < 2000, `Prototype click took ${interactionMs}ms`)

  // A publication updates both the picker and preview even while the iframe retains focus.
  state.document = { ...state.document, revision: "rev_deferred", updated: 3 }
  state.revisions = [{ ...revisions[0]!, id: "rev_deferred" }, ...state.revisions]
  state.todos = [{ ...state.todos[0]!, status: "completed" }]
  await page.locator("#note").fill("Keep my draft across the revision")
  await preview.locator("#counter").click()
  state.feed.enqueue(
    new TextEncoder().encode(
      `data: ${JSON.stringify({ type: "published", seq: 51, at: 51, design: design.id, revision: "rev_deferred", name: "Updated" })}\n\n`,
    ),
  )
  await page.waitForFunction(() => {
    const select = document.querySelector("#review")!.shadowRoot!.querySelector<HTMLSelectElement>("#revisions")!
    return select.options.length === 4 && select.value === "rev_deferred" && !select.disabled
  })
  await preview.locator("#counter").filter({ hasText: "Updated profile" }).waitFor()
  assert.equal(await page.locator("#note").inputValue(), "Keep my draft across the revision")
  const deferredPreviewUpdated = true
  assert.equal(await page.locator('[data-task="todo_profile"]').getAttribute("data-status"), "completed")
  await page.locator("#more").click()
  await page.locator("#share").click()
  await page.waitForFunction(
    () => !!document.querySelector("#review")?.shadowRoot?.querySelector("dialog[open] input[readonly]"),
  )
  assert.match(await page.locator("dialog[open] input[readonly]").inputValue(), /192\.168\.1\.10:35555/)
  await page.locator("dialog[open] button").click()
  // The live reload moved the typed message: the revision it left keeps no copy to offer again.
  const draftOf = (revision: string) =>
    page.evaluate(
      (name) => JSON.parse(localStorage.getItem(name) ?? "{}"),
      `redcode:design:${endpoint}:${design.id}:${revision}`,
    )
  assert.equal((await draftOf("rev_new")).text, undefined)
  // A note being written holds a newer revision back; the line above the preview says why and offers the way on.
  await preview.locator("body").evaluate(() =>
    parent.postMessage(
      {
        type: "design:selection",
        target: "variant:one #counter",
        text: "Updated profile",
        tag: "button",
        elementText: "Updated profile",
        label: 'button "Updated profile"',
        rect: { x: 10, y: 10, width: 120, height: 24 },
      },
      "*",
    ),
  )
  await page.locator("#card-text").fill("Make the counter bigger")
  state.document = { ...state.document, revision: "rev_blocked", updated: 4 }
  state.revisions = [{ ...revisions[0]!, id: "rev_blocked" }, ...state.revisions]
  live({ type: "published", seq: 70, at: 70, design: design.id, revision: "rev_blocked", name: "Blocked" })
  await shown("newer-label", /^R4 · 1 behind$/)
  await shown(
    "revision-line",
    /^R4 · A newer revision is ready\.Your open note belongs to this one\.Add note and switch$/,
  )
  await page.clock.runFor(5000)
  assert.equal(await page.locator("#revisions").inputValue(), "rev_deferred", "A note being written holds the switch")
  await page.locator('#revision-line [data-part="add-and-switch"]').click()
  await page.waitForFunction(() => {
    const select = document.querySelector("#review")!.shadowRoot!.querySelector<HTMLSelectElement>("#revisions")!
    return select.value === "rev_blocked" && !select.disabled
  })
  assert.equal(await page.locator("#notes .draft").count(), 1)
  assert.equal(await page.locator("#notes .draft-text").textContent(), "Make the counter bigger")
  assert.equal(await page.locator("#note").inputValue(), "Keep my draft across the revision")
  assert.equal(await page.locator("#card").isHidden(), true)
  await shown("newer-label", /^R5 · Latest$/)
  assert.equal((await draftOf("rev_deferred")).text, undefined)
  assert.equal((await draftOf("rev_deferred")).notes, undefined)
  // The steps below send the typed message alone.
  await page.locator('#notes .draft [data-copy="remove"]').click()
  assert.equal(await page.locator("#notes .draft").count(), 0, "A draft's Remove must not move away mid-click")
  assert.deepEqual(errors, [])
  // Nothing was posted on the page's own; the one reopen is the Keep reviewing click above.
  assert.equal(
    state.calls.filter((call) => call.startsWith("POST ") && call !== `POST ${endpoint}/${design.id}/reopen`).length,
    0,
  )
  // A failed revision-list fetch must retry after the document already advanced.
  state.document = { ...state.document, revision: "rev_retry", updated: 4 }
  state.revisions = [{ ...revisions[0]!, id: "rev_retry" }, ...state.revisions]
  state.failRevisions = true
  const failed = page.waitForResponse((response) => response.status() === 503)
  state.feed.enqueue(
    new TextEncoder().encode(
      `data: ${JSON.stringify({ type: "published", seq: 52, at: 52, design: design.id, revision: "rev_retry", name: "Retry" })}\n\n`,
    ),
  )
  await failed
  await page.waitForFunction(() =>
    document
      .querySelector("#review")!
      .shadowRoot!.querySelector("#status")!
      .textContent?.includes("temporarily unavailable"),
  )
  await page.clock.runFor(5000)
  await page.waitForFunction(() => {
    const select = document.querySelector("#review")!.shadowRoot!.querySelector<HTMLSelectElement>("#revisions")!
    return select.options.length === 6 && select.value === "rev_retry"
  })
  // A review the server refuses is released, not held for a retry: the draft stays editable and the
  // next send is a new message.
  state.failFeedback = true
  await page.locator("#send").click()
  await page.waitForFunction(() =>
    document
      .querySelector("#review")!
      .shadowRoot!.querySelector("#status")!
      .textContent?.includes("too long to send as one message"),
  )
  assert.equal(await page.locator("#send").getAttribute("data-copy"), "send")
  assert.equal(await page.locator("#note").isEnabled(), true)
  assert.equal(await page.locator("#note").inputValue(), "Keep my draft across the revision")
  assert.equal(await page.locator("#feedback-status").isHidden(), true)
  assert.equal(state.feedback.length, 0)
  assert.ok(state.refused, "The refused review must have reached the server once")
  // A conflict (409) is held for a resend instead; Discard releases it and clears the composer.
  state.conflictFeedback = true
  await page.locator("#send").click()
  await page.locator("#pending-actions").waitFor()
  assert.match(
    (await page.locator("#feedback-status").textContent()) ?? "",
    /HTTP 409: Reload the latest revision before sending/,
  )
  assert.equal(await page.locator("#note").isDisabled(), true)
  await page.locator("#discard-pending").click()
  await page.locator("#pending-actions").waitFor({ state: "hidden" })
  assert.equal(await page.locator("#note").isEnabled(), true)
  assert.equal(await page.locator("#note").inputValue(), "")
  assert.equal(await page.locator("#feedback-status").isHidden(), true)
  assert.equal(state.feedback.length, 0)
  assert.ok(state.conflicted, "The conflicting review must have reached the server once")
  await page.locator("#note").fill("Keep my draft, shortened to fit")
  await page.locator("#send").click()
  await page.waitForFunction(() =>
    document.querySelector("#review")!.shadowRoot!.querySelector("#feedback-status")!.textContent?.includes("received"),
  )
  assert.equal(state.feedback.length, 1)
  assert.notEqual(state.feedback[0]!.id, state.refused)
  assert.equal(state.feedback[0]!.text, "Keep my draft, shortened to fit")
  assert.deepEqual(state.feedback[0]!.assets, [])
  assert.equal(state.captures.length, 0, "Feedback rounds must not capture screenshots")
  await page.locator("#note").fill("My unsent notes must survive anti-slop")
  const beforeReview = state.calls.filter((call) => call.endsWith("/preview")).length
  await page.locator("#variant-actions").click()
  await page.locator("#run-anti-slop").click()
  assert.ok(
    (await page.locator("#anti-slop-dialog").textContent())?.includes("fix the findings and publish the changes"),
  )
  await page.locator("#anti-slop-text").fill("Focus on accessibility and empty states")
  await page.locator("#confirm-anti-slop").click()
  await page.waitForFunction(
    () => !document.querySelector("#review")!.shadowRoot!.querySelector("#anti-slop-dialog")?.hasAttribute("open"),
  )
  assert.equal(state.feedback.at(-1)?.review?.id, "one")
  assert.equal(state.feedback.at(-1)?.revision, "rev_retry")
  assert.equal(state.feedback.at(-1)?.text, "Focus on accessibility and empty states")
  assert.equal(await page.locator("#note").inputValue(), "My unsent notes must survive anti-slop")
  assert.equal(state.calls.filter((call) => call.endsWith("/preview")).length, beforeReview)
  assert.equal(state.captures.length, 0)
  await page.locator("#variant-actions").click()
  await page.locator("#run-anti-slop").click()
  await page.locator("#confirm-anti-slop").click()
  await page.waitForFunction(
    () => !document.querySelector("#review")!.shadowRoot!.querySelector("#anti-slop-dialog")?.hasAttribute("open"),
  )
  assert.equal(state.feedback.at(-1)?.review?.id, "one")
  assert.equal(state.feedback.at(-1)?.text, "")
  // A CLI approval moves the live session to Plan; the open browser clears its prototype and feed.
  state.document = { ...state.document, approvedRevision: "rev_retry", ended: true }
  state.feed.enqueue(
    new TextEncoder().encode(
      `data: ${JSON.stringify({
        type: "agent",
        seq: 53,
        at: 53,
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
  await page.clock.resume()
  await preview.locator("#counter").click()
  await page.locator("#approve").click()
  state.failApproval = true
  await page.locator("#confirm-approve").click()
  await page.waitForFunction(() =>
    document.querySelector("#review")!.shadowRoot!.querySelector("#status")!.textContent?.includes("Retry approval"),
  )
  assert.equal(state.captures.length, 1, "Approval captures the live preview exactly once")
  const source = JSON.parse(state.captures[0]!.source)
  assert.equal(source.type, "design-approval-capture")
  assert.equal(source.revision, "rev_retry")
  assert.equal(source.reference, "$screenshot1")
  assert.equal(source.variant, "one")
  assert.equal(source.screen, "profile")
  const png = PNG.sync.read(Buffer.from(state.captures[0]!.data, "base64"))
  assert.deepEqual(
    [...png.data.subarray((80 * png.width + 60) * 4, (80 * png.width + 60) * 4 + 3)],
    [0, 192, 0],
    "The image must show the live green marker rather than its original red state",
  )
  const privatePixels = Array.from({ length: 35 }, (_, row) =>
    Array.from({ length: 130 }, (_, column) => {
      const pixel = ((row + 70) * png.width + column + 225) * 4
      return png.data[pixel] !== 255 || png.data[pixel + 1] !== 255 || png.data[pixel + 2] !== 255
    }),
  )
    .flat()
    .filter(Boolean).length
  assert.equal(privatePixels, 0, "Payment input text must be blanked before rasterization")
  // Changed viewport state on retry cannot replace the approval's original reference.
  await preview.locator("#capture-marker").evaluate((node) => {
    ;(node as HTMLElement).style.background = "#0000ff"
  })
  await page.locator("#confirm-approve").click()
  await page.waitForFunction(() => {
    const root = document.querySelector("#review")!.shadowRoot!
    return !root.querySelector("iframe") && root.textContent?.includes("Design approved")
  })
  assert.equal(state.captures.length, 1)
  assert.equal(state.approvals[0]!.screenshot, state.approvals[1]!.screenshot)
  const approvedRequests = state.calls.length
  await page.clock.runFor(15000)
  assert.equal(state.calls.length, approvedRequests, "Browser approval must stop polling")
  assert.deepEqual(errors, [])
  // Opt-out and failed rasterization both leave the explicit approval available. A prototype that keeps
  // thousands of hidden elements, or whose variant root has no box of its own, still yields its screenshot.
  for (const mode of ["opt-out", "capture-failure", "scrolled-capture", "hidden-screens", "boxless-variant"]) {
    state.document = { ...state.document, approvedRevision: null, ended: false }
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForFunction(
      () => !document.querySelector("#review")!.shadowRoot!.querySelector<HTMLButtonElement>("#approve")?.disabled,
    )
    await preview.locator("#counter").waitFor()
    if (mode === "capture-failure")
      await preview.locator("body").evaluate(() => {
        HTMLCanvasElement.prototype.toDataURL = () => {
          throw new Error("Capture unavailable")
        }
      })
    if (mode === "scrolled-capture")
      await preview.locator("body").evaluate(() => {
        document.body.style.height = "2000px"
        document.querySelector<HTMLElement>("#capture-marker")!.style.background = "#00c000"
        window.scrollTo(0, 200)
      })
    if (mode === "hidden-screens")
      await preview.locator("body").evaluate(() => {
        document.body.insertAdjacentHTML(
          "beforeend",
          `<section hidden>${"<p><span>hidden</span><b>row</b></p>".repeat(3000)}</section>`,
        )
      })
    if (mode === "boxless-variant")
      await preview.locator("body").evaluate(() => {
        document.querySelector<HTMLElement>('[data-design-variant="one"]')!.style.display = "contents"
      })
    await page.locator("#approve").click()
    if (mode === "opt-out") await page.locator("#approval-screenshot").uncheck()
    await page.locator("#confirm-approve").click()
    await page.waitForFunction(() => !document.querySelector("#review")!.shadowRoot!.querySelector("iframe"))
    if (mode === "scrolled-capture") {
      assert.ok(state.approvals.at(-1)!.screenshot)
      const source = JSON.parse(state.captures.at(-1)!.source)
      assert.equal(source.scrollY, 200)
      const png = PNG.sync.read(Buffer.from(state.captures.at(-1)!.data, "base64"))
      assert.deepEqual(
        [...png.data.subarray((80 * png.width + 60) * 4, (80 * png.width + 60) * 4 + 3)],
        [0, 192, 0],
        "Viewport-fixed controls remain visible after scrolling",
      )
    }
    if (mode === "hidden-screens" || mode === "boxless-variant") {
      assert.ok(state.approvals.at(-1)!.screenshot, `${mode} must still attach the approval screenshot`)
      assert.equal(JSON.parse(state.captures.at(-1)!.source).variant, "one")
    }
    if (mode === "opt-out" || mode === "capture-failure") {
      assert.equal(state.approvals.at(-1)!.screenshot, undefined)
      assert.equal(state.captures.length, 1)
    }
    if (mode === "capture-failure")
      assert.ok(
        (await page.locator("#review").evaluate((node) => node.shadowRoot?.textContent))?.includes(
          "screenshot unavailable",
        ),
      )
  }
  // The Platform control in Details shows for an app design and saves the platform the agent designs for.
  state.document = { ...state.document, approvedRevision: null, ended: false, target: "app" }
  await page.reload()
  // The first load holds every action until it is done, the platform change included.
  await page.waitForFunction(
    () => !document.querySelector("#review")!.shadowRoot!.querySelector<HTMLButtonElement>("#approve")?.disabled,
  )
  await page.locator("#tab-details").click()
  await page.locator("#platform-field").waitFor()
  assert.equal(await page.locator("#platform").inputValue(), "")
  await page.locator("#platform").selectOption("android")
  await page.waitForFunction(
    () =>
      document.querySelector("#review")!.shadowRoot!.querySelector<HTMLOptionElement>('#platform option[value=""]')
        ?.disabled === true,
  )
  assert.deepEqual(state.platforms, ["android"])
  assert.equal(state.document.platform, "android")
  assert.equal(await page.locator("#platform").inputValue(), "android")
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
      idleRoundMutations,
      deferredPreviewUpdated,
      interactionMs,
      browserErrors: errors.length,
      automaticPublications: 0,
      closedPreviewFrames,
      closedPollingRequests,
      browserApprovalPollingRequests: 0,
      approvalScreenshots: state.captures.length,
      feedbackScreenshots: state.feedback.flatMap((feedback) => feedback.assets).length,
      revisionListRetry: true,
    }),
  )
} catch (error) {
  console.error(
    "Design smoke failed",
    state.calls.slice(-25),
    await page.evaluate(() => {
      const root = document.querySelector("#review")?.shadowRoot
      return {
        status: root?.querySelector("#status")?.textContent,
        jobs: root?.querySelector("#jobs")?.children.length,
        picker: root?.querySelector<HTMLSelectElement>("#revisions")?.value,
        preview: root?.querySelector("#preview-error")?.textContent,
      }
    }),
  )
  throw error
} finally {
  clearInterval(heartbeats)
  await browser.close()
  await server.stop(true)
}
