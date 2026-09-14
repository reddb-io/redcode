import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { chromium, type Browser, type Page } from "playwright-core"
import { parseGIF, decompressFrames } from "gifuct-js"
import type { Design } from "@reddb-io/redcode-schema/design"
import { webHandler } from "../src/routes"
import { designDependencies } from "../../core/test/fixture/design-dependencies"

const temporary = await mkdtemp(path.join(os.tmpdir(), "design-browser-"))
const directory = path.join(temporary, "alias")
await mkdir(path.join(temporary, "workspace"))
await symlink(path.join(temporary, "workspace"), directory, process.platform === "win32" ? "junction" : "dir")
const web = webHandler()
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (request) => web.handler(request),
})
const base = server.url.origin
let browser: Browser

const api = async <T>(route: string, method = "GET", body?: unknown): Promise<T> => {
  const response = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
  return response.json()
}
const session = () =>
  api<{ data: { id: string } }>("/api/session", "POST", { location: { directory }, agent: "design" })
const published = async (engine: "html" | "solid") => {
  const current = await session()
  const root = `/api/session/${current.data.id}/design`
  const document = await api<Design.Info>(root, "POST", {
    name: "Checkout",
    journey: engine === "html" ? "new" : "existing",
    engine,
    kind: "screen",
  })
  await Bun.write(
    path.join(document.root, document.entry),
    engine === "html"
      ? '<!doctype html><html lang="en"><head><title>Checkout</title></head><body><main><h1 id="title">Checkout</h1><button id="submit" onclick="this.textContent=\'Added\';this.dataset.state=\'populated\'" data-state="empty">Add item</button><pre id="diagram" data-mermaid-source="graph TD\nA --> B">diagram</pre></main></body></html>'
      : 'import { render } from "solid-js/web"; import { createSignal } from "solid-js"; const App=()=>{const [added,setAdded]=createSignal(false);return <main><section data-design-variant="compact" data-design-label="Compact"><h1>Checkout</h1><button onClick={()=>setAdded(true)}>{added()?"Added":"Add item"}</button></section><section data-design-variant="spacious" data-design-label="Spacious"><h1>Spacious checkout</h1></section></main>};render(()=><App />,document.getElementById("root")!)',
  )
  const revision = await api<Design.Revision>(`${root}/${document.id}/revision`, "POST", { name: "First direction" })
  return { document, revision, root, sessionID: current.data.id }
}
/** One row of the review's notes list: the element label with the note written for it. */
const note = (page: Page, label: string, text: string) =>
  page
    .locator("#notes .note")
    .filter({ has: page.locator(".note-label", { hasText: label }) })
    .filter({ has: page.locator(".note-text", { hasText: text }) })
/** Waits until the review shows a revision, for example once polling has live-reloaded a newly published one. */
const showsRevision = (page: Page, id: string) =>
  page.waitForFunction(
    (revision) =>
      document.querySelector("#review")!.shadowRoot!.querySelector<HTMLSelectElement>("#revisions")!.value === revision,
    id,
    { timeout: 8000 },
  )
const activeID = (page: Page) =>
  page.evaluate(() => document.querySelector("#review")!.shadowRoot!.activeElement?.id ?? "")
/** Turns the toolbar's annotation toggle on or off, clicking only when it is in the other state. */
const annotate = async (page: Page, enabled: boolean) => {
  const toggle = page.getByRole("button", { name: "Annotate elements", exact: true })
  if ((await toggle.getAttribute("aria-pressed")) !== String(enabled)) await toggle.click()
  expect(await toggle.getAttribute("aria-pressed")).toBe(String(enabled))
}

beforeAll(async () => {
  await Bun.write(path.join(directory, "redcode.json"), JSON.stringify({ permission: { external_directory: "allow" } }))
  await designDependencies(directory)
  browser = await chromium.launch()
}, 30000)
afterAll(async () => {
  await browser?.close()
  await server.stop(true)
  await web.dispose()
  await rm(temporary, { recursive: true, force: true })
}, 30000)

test("intake creates a new alternative without polling closing the brief", async () => {
  const current = await published("html")
  const page = await browser.newPage()
  await page.goto(`${base}${current.root}/review`)
  await page.getByRole("button", { name: "More actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Create design", exact: true }).click()
  await page.getByLabel("Name", { exact: true }).fill("Alternative")
  await page.getByLabel("What should this interface accomplish?").fill("Help people finish checkout")
  await page.waitForTimeout(5200)
  expect(await page.getByLabel("Name", { exact: true }).isVisible()).toBe(true)
  await page.locator("form").getByRole("button", { name: "Create design", exact: true }).click()
  await page.getByRole("option", { name: "Alternative", exact: true }).waitFor({ state: "attached" })
  const documents = await api<Design.Info[]>(current.root)
  expect(documents).toHaveLength(2)
  expect(documents.find((document) => document.name === "Alternative")?.brief.objective).toBe(
    "Help people finish checkout",
  )
  await page.close()
}, 60000)

test("new interface: native review, annotation draft, lost response retry and approval", async () => {
  const current = await published("html")
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${base}${current.root}/review`)
  const frame = page.frameLocator("#preview")
  await frame.getByRole("button", { name: "Add item" }).click()
  expect(await frame.getByRole("button", { name: "Added" }).textContent()).toBe("Added")
  await annotate(page, true)
  const card = page.getByLabel("Note for this element", { exact: true })
  await frame.getByRole("heading", { name: "Checkout" }).click()
  await card.fill("Make this title more prominent")
  await card.press("Enter")
  // A drag selection inside one element survives the click that follows it.
  await frame.getByRole("heading", { name: "Checkout" }).selectText()
  await frame.getByRole("heading", { name: "Checkout" }).dispatchEvent("click")
  await card.fill("Use a verb here")
  await card.press("Enter")
  await frame.locator("#diagram").click()
  await page.locator("#card-label", { hasText: 'pre "diagram"' }).waitFor()
  await card.fill("Swap the arrow")
  await card.press("Enter")
  await page.reload()
  await note(page, 'h1 "Checkout"', "Make this title more prominent").waitFor()
  await note(page, 'h1 "Checkout"', "Use a verb here").waitFor()
  expect(await page.locator("#notes").textContent()).not.toContain("#title")
  expect(await page.locator("#card").isHidden()).toBe(true)
  const feedback: Design.Feedback[] = []
  await page.route("**/feedback", async (route) => {
    feedback.push(route.request().postDataJSON())
    const response = await route.fetch()
    if (feedback.length === 1) {
      await route.abort("failed")
      return
    }
    await route.fulfill({ response })
  })
  await page.getByRole("button", { name: "Send to agent", exact: true }).click()
  await page.getByRole("button", { name: "Retry sending saved feedback" }).waitFor()
  expect(await page.getByRole("button", { name: "Send & end", exact: true }).isVisible()).toBe(false)
  await page.getByRole("button", { name: "Retry sending saved feedback" }).click()
  await page.getByText("Feedback received", { exact: true }).waitFor()
  expect(feedback).toHaveLength(2)
  expect(feedback[1]).toEqual(feedback[0])
  expect(feedback[0].text).toBe("")
  expect(feedback[0].delivery).toBe("steer")
  expect(feedback[0].end).toBe(false)
  expect(feedback[0].items).toHaveLength(3)
  expect(feedback[0].items[0]).toMatchObject({
    target: "#title",
    text: "Make this title more prominent",
    tag: "h1",
    elementText: "Checkout",
    label: 'h1 "Checkout"',
  })
  expect(feedback[0].items[0].selectedText).toBeUndefined()
  expect(feedback[0].items[1]).toMatchObject({
    target: "#title",
    text: "Use a verb here",
    tag: "h1",
    elementText: "Checkout",
    selectedText: "Checkout",
    label: 'h1 "Checkout"',
  })
  expect(feedback[0].items[2]).toMatchObject({
    target: "#diagram",
    text: "Swap the arrow",
    tag: "pre",
    elementText: "diagram",
    selectedText: "graph TD\nA --> B",
    label: 'pre "diagram"',
  })
  expect(feedback[0].snapshot).toContain("Checkout")
  const history = await api<{ data: { type: string; data: { prompt?: { text: string; files?: unknown[] } } }[] }>(
    `/api/session/${current.sessionID}/history?limit=100`,
  )
  const prompted = history.data.filter((event) => event.type === "session.next.prompted")
  expect(prompted).toHaveLength(1)
  const message = prompted[0].data.prompt!.text
  expect(message).toStartWith(
    `<design-review id="${current.document.id}" revision="${current.revision.id}" feedback="${feedback[0].id}" ended="false">`,
  )
  expect(message).toContain(
    '### 1. h1 "Checkout" — #title\nNote: Make this title more prominent\nElement text: "Checkout"',
  )
  expect(message).toContain('### 2. h1 "Checkout" — #title\nNote: Use a verb here\nSelected text: "Checkout"')
  expect(message).toContain('### 3. pre "diagram" — #diagram\nNote: Swap the arrow\nSelected text: "graph TD A --> B"')
  expect(message.split("Element text:")).toHaveLength(3)
  expect(message).not.toContain("## Message")
  expect(message).not.toContain("Add item")
  expect(message).toContain('"section":"snapshot"')
  await page.getByRole("button", { name: "Approve this revision" }).click()
  await page.getByRole("button", { name: "Approve and continue in Plan", exact: true }).click()
  await page.getByRole("button", { name: "Reopen review" }).waitFor()
  const approved = await api<Design.Info>(`${current.root}/${current.document.id}`)
  expect(approved.approvedRevision).toBe(current.revision.id)
  expect(errors).toEqual([])
  await page.close()
}, 90000)

test("existing Solid component: isolated interactive preview and history restoration", async () => {
  const current = await published("solid")
  const second = await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", {
    name: "Second direction",
  })
  const page = await browser.newPage()
  await page.goto(`${base}${current.root}/review`)
  const frame = page.frameLocator("#preview")
  await frame.getByRole("button", { name: "Add item" }).click()
  expect(await frame.getByRole("button", { name: "Added" }).textContent()).toBe("Added")
  // Switching variants closes a card anchored in the variant that leaves the screen.
  await annotate(page, true)
  await frame.getByRole("heading", { name: "Checkout", exact: true }).click()
  await page.locator("#card:not([hidden])").waitFor()
  await page.getByRole("tab", { name: "Spacious", exact: true }).click()
  await page.locator("#card").waitFor({ state: "hidden" })
  await annotate(page, false)
  await frame.getByRole("heading", { name: "Spacious checkout" }).waitFor()
  expect(await frame.getByRole("heading", { name: "Checkout", exact: true }).isVisible()).toBe(false)
  // Restore is offered only once an older revision is on screen.
  expect(await page.getByRole("button", { name: "Restore as new revision" }).isVisible()).toBe(false)
  await page.getByLabel("Revision", { exact: true }).selectOption(current.revision.id)
  await page.getByRole("button", { name: "Restore as new revision", exact: true }).waitFor()
  await page.getByRole("button", { name: "Restore as new revision" }).click()
  await page.getByRole("option", { name: /Restored: First direction/ }).waitFor({ state: "attached" })
  const revisions = await api<Design.Revision[]>(`${current.root}/${current.document.id}/revision`)
  expect(revisions).toHaveLength(3)
  // The restored copy of the first revision lands on top of the latest one.
  expect(revisions[0].name).toBe("Restored: First direction")
  expect(revisions[0].parent).toBe(second.id)
  await page.close()
}, 90000)

test("refresh reloads the preview and keeps request errors visible across polling", async () => {
  const current = await published("html")
  await api(`${current.root}/${current.document.id}/revision`, "POST", { name: "Second direction" })
  const page = await browser.newPage()
  try {
    await page.goto(`${base}${current.root}/review`)
    const frame = page.frameLocator("#preview")
    await frame.getByRole("button", { name: "Add item" }).click()
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    await frame.getByRole("button", { name: "Add item" }).waitFor({ timeout: 3000 })
    await page.getByLabel("Revision", { exact: true }).selectOption(current.revision.id)
    await page.getByRole("button", { name: "Restore as new revision", exact: true }).waitFor()
    await page.route("**/restore", (route) =>
      route.fulfill({ status: 409, json: { message: "Reopen this design before restoring" } }),
    )
    await page.getByRole("button", { name: "Restore as new revision" }).click()
    await page.getByRole("status").filter({ hasText: "Reopen this design before restoring" }).waitFor({ timeout: 3000 })
    await page.waitForTimeout(5500)
    expect(await page.getByRole("status").textContent()).toContain("Reopen this design before restoring")
  } finally {
    await page.close()
  }
}, 30000)

test("approval provides pending feedback, prevents duplicate clicks and confirms the terminal handoff", async () => {
  const current = await published("html")
  const page = await browser.newPage()
  const gate = Promise.withResolvers<void>()
  const requests: unknown[] = []
  await page.route("**/approve", async (route) => {
    requests.push(route.request().postDataJSON())
    await gate.promise
    await route.continue()
  })
  try {
    await page.goto(`${base}${current.root}/review`)
    await page.getByRole("button", { name: "Approve this revision" }).click()
    const approve = page.getByRole("button", { name: "Approve and continue in Plan", exact: true })
    await approve.click()
    expect(await approve.getAttribute("aria-busy")).toBe("true")
    expect(await approve.isDisabled()).toBe(true)
    await approve.evaluate((button: HTMLButtonElement) => button.click())
    expect(requests).toHaveLength(1)
    gate.resolve()
    await page.getByRole("button", { name: "Reopen review" }).waitFor()
    await page.locator("#status").filter({ hasText: "Design approved. Continue in the terminal" }).waitFor()
    expect(await page.locator("#status").textContent()).toContain("Design approved. Continue in the terminal")
    const document = await api<Design.Info>(`${current.root}/${current.document.id}`)
    expect(document.approvedRevision).toBe(current.revision.id)
  } finally {
    gate.resolve()
    await page.close()
  }
}, 30000)

test("approval freezes the selected variant and exposes it after reload and newer drafts", async () => {
  const current = await published("solid")
  const page = await browser.newPage()
  try {
    await page.goto(`${base}${current.root}/review`)
    await page.getByRole("tab", { name: "Spacious", exact: true }).click()
    await page.getByRole("button", { name: "Approve this revision" }).click()
    expect(await page.locator("#approval-revision").textContent()).toContain("Spacious")
    await page.locator("#cancel-approve").click()
    expect((await api<Design.Info>(`${current.root}/${current.document.id}`)).approvedRevision).toBeNull()
    await page.getByRole("button", { name: "Approve this revision" }).click()
    await page.getByRole("button", { name: "Approve and continue in Plan", exact: true }).click()
    await page.getByRole("button", { name: "Reopen review" }).waitFor()
    const record = await api<Design.Approval>(`${current.root}/${current.document.id}/approval/${current.revision.id}`)
    expect(record.variant).toEqual({ id: "spacious", name: "Spacious" })
    expect(record.version).toBe(1)
    await page.reload()
    await page.locator("#approved-record summary").click()
    expect(await page.locator("#approved-details").textContent()).toContain("Spacious (spacious)")
    const conflict = await fetch(`${base}${current.root}/${current.document.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: current.revision.id, variant: { id: "compact", name: "Compact" } }),
    })
    expect(conflict.ok).toBe(false)
    await api(`${current.root}/${current.document.id}/reopen`, "POST")
    await Bun.write(
      path.join(current.document.root, current.document.entry),
      'document.getElementById("root").textContent="A completely new draft"',
    )
    await api(`${current.root}/${current.document.id}/revision`, "POST", { name: "Unapproved replacement" })
    await page.reload()
    await page.locator("#approved-record summary").click()
    expect(await page.locator("#approved-details").textContent()).toContain("Spacious (spacious)")
    expect(await page.locator("#approved-details").textContent()).not.toContain("Unapproved replacement")
  } finally {
    await page.close()
  }
}, 60000)

test("variants switch independently, compare at device widths and request another direction without losing notes", async () => {
  const current = await published("html")
  await Bun.write(
    path.join(current.document.root, current.document.entry),
    `<!doctype html><html><body>
    <section data-design-variant="graphite" data-design-label="Graphite"><h1>Graphite checkout</h1><button onclick="this.textContent='Graphite added'">Add graphite</button></section>
    <section data-design-variant="stone" data-design-label="Stone"><h1>Stone checkout</h1><button onclick="this.textContent='Stone added'">Add stone</button></section>
    </body></html>`,
  )
  const revision = await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", {
    name: "Two directions",
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const feedback: Design.Feedback[] = []
  await page.route("**/feedback", async (route) => {
    feedback.push(route.request().postDataJSON())
    const response = await route.fetch()
    if (feedback.length === 1) return route.abort("failed")
    await route.fulfill({ response })
  })
  try {
    await page.goto(`${base}${current.root}/review`)
    const preview = page.frameLocator("#preview")
    const peer = page.frameLocator("#peer-preview")
    await page.getByRole("tab", { name: "Graphite", exact: true }).waitFor()
    await preview.getByRole("heading", { name: "Graphite checkout" }).waitFor()
    expect(await preview.getByRole("heading", { name: "Stone checkout" }).isVisible()).toBe(false)
    await page.getByRole("tab", { name: "Graphite", exact: true }).focus()
    await page.keyboard.press("ArrowRight")
    await preview.getByRole("heading", { name: "Stone checkout" }).waitFor()
    expect(await preview.getByRole("heading", { name: "Graphite checkout" }).isVisible()).toBe(false)
    await page.getByRole("button", { name: "Side by side", exact: true }).click()
    await peer.getByRole("heading", { name: "Graphite checkout" }).waitFor()
    await peer.getByRole("button", { name: "Add graphite" }).click()
    await preview.getByRole("button", { name: "Add stone" }).waitFor()
    await page.getByLabel("Preview width", { exact: true }).selectOption("390")
    expect(await preview.locator("body").evaluate(() => innerWidth)).toBe(390)
    expect(await peer.locator("body").evaluate(() => innerWidth)).toBe(390)
    await page.getByLabel("Preview width", { exact: true }).selectOption("1440")
    expect(await preview.locator("body").evaluate(() => innerWidth)).toBe(1440)
    expect(await peer.locator("body").evaluate(() => innerWidth)).toBe(1440)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByLabel("Review notes", { exact: true }).fill("Keep my unsent notes")
    await page.getByRole("button", { name: "Add variant", exact: true }).click()
    await page.getByLabel("What should the new variant explore?").fill("Try a warmer palette with denser navigation")
    await page.getByRole("button", { name: "Request variant", exact: true }).click()
    await page
      .locator("#variant-dialog [data-action-status]")
      .filter({ hasText: /Failed to fetch/ })
      .waitFor()
    await page.reload()
    await page.getByRole("button", { name: "Add variant", exact: true }).click()
    expect(await page.getByLabel("What should the new variant explore?").inputValue()).toContain("warmer palette")
    await page.getByRole("button", { name: "Request variant", exact: true }).click()
    await page.getByText("Variant requested. The agent will publish a new revision here.", { exact: true }).waitFor()
    expect(feedback).toHaveLength(2)
    expect(feedback[1]).toEqual(feedback[0])
    expect(feedback[0].revision).toBe(revision.id)
    expect(feedback[0].text).toContain("Reference variant: stone")
    expect(feedback[0].text).toContain("warmer palette")
    expect(feedback[0].end).toBe(false)
    expect(await page.getByLabel("Review notes", { exact: true }).inputValue()).toBe("Keep my unsent notes")
    const updated = await api<Design.Info>(`${current.root}/${current.document.id}`)
    expect(updated.ended).toBe(false)
    expect(await page.locator("#preview").getAttribute("sandbox")).not.toContain("allow-same-origin")
    // On the latest revision a publication reloads the preview in place and keeps the unsent notes.
    await Bun.write(
      path.join(current.document.root, current.document.entry),
      `<!doctype html><html><body><section data-design-variant="warm" data-design-label="Warm"><h1>Warm checkout</h1></section></body></html>`,
    )
    await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", { name: "Warmer direction" })
    await page.getByRole("tab", { name: "Warm", exact: true }).waitFor({ timeout: 10000 })
    await preview.getByRole("heading", { name: "Warm checkout" }).waitFor()
    await page.locator("#status").filter({ hasText: "Revision published" }).waitFor()
    expect(await page.getByRole("button", { name: "New revision available", exact: true }).isVisible()).toBe(false)
    expect(await page.getByLabel("Review notes", { exact: true }).inputValue()).toBe("Keep my unsent notes")
    await page.getByLabel("Revision", { exact: true }).selectOption(revision.id)
    await page.getByRole("tab", { name: "Stone", exact: true }).waitFor()
    expect(await page.getByLabel("Review notes", { exact: true }).inputValue()).toBe("Keep my unsent notes")
    // While browsing history a publication only offers the button; nothing reloads underneath the reader.
    await Bun.write(
      path.join(current.document.root, current.document.entry),
      `<!doctype html><html><body><section data-design-variant="cool" data-design-label="Cool"><h1>Cool checkout</h1></section></body></html>`,
    )
    await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", { name: "Cooler direction" })
    await page.getByRole("button", { name: "New revision available", exact: true }).waitFor({ timeout: 10000 })
    expect(await page.getByRole("button", { name: "Approve this revision" }).isDisabled()).toBe(true)
    await page.waitForTimeout(5500)
    await page.getByRole("tab", { name: "Stone", exact: true }).waitFor()
    await page.getByRole("button", { name: "New revision available", exact: true }).click()
    await page.getByRole("tab", { name: "Cool", exact: true }).waitFor()
    await preview.getByRole("heading", { name: "Cool checkout" }).waitFor()
    await page.getByLabel("Revision", { exact: true }).selectOption(revision.id)
    await page.getByRole("tab", { name: "Stone", exact: true }).waitFor()
    expect(await page.getByLabel("Review notes", { exact: true }).inputValue()).toBe("Keep my unsent notes")
  } finally {
    await page.close()
  }
}, 90000)

test("SVG asset: browser import, local GIF progress and downloadable animation", async () => {
  const current = await published("html")
  const page = await browser.newPage({ acceptDownloads: true })
  await page.goto(`${base}${current.root}/review`)
  await page.locator("#attachment:enabled").waitFor()
  await page.getByLabel("Attach image or SVG").setInputFiles({
    name: "motion.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><circle r="4" cy="10" fill="red"><animate attributeName="cx" values="4;36;4" dur="1s" repeatCount="indefinite"/></circle></svg>',
    ),
  })
  await page.getByRole("tab", { name: "Assets", exact: true }).click()
  await page.getByRole("option", { name: "motion.svg" }).waitFor({ state: "attached" })
  await page.waitForFunction(() => {
    const image = document.querySelector("#review")?.shadowRoot?.querySelector<HTMLImageElement>("#assets img")
    return image?.src.startsWith("blob:") && image.complete && image.naturalWidth > 0
  })
  await page.getByLabel("Seconds", { exact: true }).fill("0.3")
  await page.getByLabel("Longest edge (px)").fill("128")
  await page.getByRole("button", { name: "SVG to GIF", exact: true }).click()
  await page.getByRole("button", { name: "Download", exact: true }).waitFor({ timeout: 90000 })
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download", exact: true }).click()
  const artifact = await download
  const file = await artifact.path()
  const gif = parseGIF(await Bun.file(file!).arrayBuffer())
  expect(gif.lsd.width).toBe(128)
  expect(gif.lsd.height).toBe(64)
  expect(decompressFrames(gif, true)).toHaveLength(6)
  const assets = await api<Design.Asset[]>(`${current.root}/${current.document.id}/asset`)
  expect(assets).toHaveLength(1)
  expect(assets[0].mime).toBe("image/svg+xml")
  await page.close()
}, 120000)

test("diagram review retains the Excalidraw whiteboard and queues an image plus editable scene", async () => {
  const current = await published("html")
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${base}${current.root}/review`)
  await page.locator("summary").getByText("Diagram or selected content", { exact: true }).click()
  await page.getByLabel("Diagram or selected content", { exact: true }).fill("graph TD\nA[Start] --> B[Review]")
  await page.getByRole("button", { name: "Open diagram whiteboard", exact: true }).click()
  const frame = page.frameLocator("#board-frame")
  await frame
    .getByRole("button", { name: "Queue feedback", exact: true })
    .waitFor({ timeout: 15000 })
    .catch(async (error) => {
      console.error({
        errors,
        status: await page.locator("#status").textContent(),
        body: await frame
          .locator("body")
          .innerText()
          .then((text) => text.slice(0, 500))
          .catch(() => "missing"),
      })
      throw error
    })
  await frame
    .locator(".excalidraw canvas")
    .first()
    .waitFor({ timeout: 15000 })
    .catch(async (error) => {
      console.error({
        errors,
        board: await frame
          .locator("body")
          .innerText()
          .then((text) => text.slice(0, 1000)),
      })
      throw error
    })
  await frame.locator("#wbNote").fill("Keep these steps clear")
  const upload = `${base}${current.root}/${current.document.id}/asset`
  await page.route(upload, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 409, json: { message: "Image import unavailable" } })
      : route.continue(),
  )
  await frame.getByRole("button", { name: "Queue feedback", exact: true }).click()
  await frame.locator("#wbStatus").getByText("Queue failed:", { exact: false }).waitFor()
  expect(await frame.getByRole("button", { name: "Queue feedback", exact: true }).isEnabled()).toBe(true)
  expect(await frame.locator("#wbNote").inputValue()).toBe("Keep these steps clear")
  expect(await page.locator("#notes").textContent()).toBe("")
  await page.unroute(upload)
  await frame.getByRole("button", { name: "Queue feedback", exact: true }).click()
  await note(page, "diagram", "Keep these steps clear").waitFor({ timeout: 60000 })
  await page.getByRole("button", { name: "Send to agent", exact: true }).click()
  await page.getByText("Feedback received", { exact: true }).waitFor()
  const scenes = await Array.fromAsync(
    new Bun.Glob("*.excalidraw").scan({ cwd: path.join(current.document.root, "../reviews") }),
  )
  expect(scenes).toHaveLength(1)
  const scene = await Bun.file(path.join(current.document.root, "../reviews", scenes[0])).json()
  expect(scene.type).toBe("excalidraw")
  expect(scene.elements.length).toBeGreaterThan(0)
  expect(errors).toEqual([])
  await page.close()
}, 120000)

test("publishing a product dependency requests read permission and preserves denial", async () => {
  const current = await published("solid")
  await Bun.write(path.join(directory, ".env.design-fixture"), "ONLY_TEST_DATA")
  await Bun.write(
    path.join(current.document.root, current.document.entry),
    `import value from ${JSON.stringify(path.join(directory, ".env.design-fixture") + "?raw")}; document.body.textContent = value`,
  )
  const response = fetch(`${base}${current.root}/${current.document.id}/revision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Needs authorization" }),
  })
  const permission = await Promise.race([
    (async () => {
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        const result = await api<{ data: { id: string; action: string; resources: string[] }[] }>(
          `/api/session/${current.sessionID}/permission`,
        )
        const request = result.data.find(
          (item) => item.action === "read" && item.resources.includes(".env.design-fixture"),
        )
        if (request) return request
        await Bun.sleep(20)
      }
      const pending = await api<{ data: { action: string; resources: string[] }[] }>(
        `/api/session/${current.sessionID}/permission`,
      )
      throw new Error(
        `No protected dependency permission request: ${JSON.stringify({
          pending: pending.data,
          directory,
          promiseRoot: await fs.promises.realpath(directory),
          callbackRoot: await new Promise<string>((resolve, reject) =>
            fs.realpath(directory, (error, resolved) => (error ? reject(error) : resolve(resolved))),
          ),
        })}`,
      )
    })(),
    response.then(() => {
      throw new Error("Publish completed before asking permission")
    }),
  ])
  const reply = await fetch(`${base}/api/session/${current.sessionID}/permission/${permission.id}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reply: "reject" }),
  })
  expect(reply.ok).toBe(true)
  expect((await response).ok).toBe(false)
  const revisions = await api<Design.Revision[]>(`${current.root}/${current.document.id}/revision`)
  expect(revisions).toHaveLength(1)
  expect(revisions[0].id).toBe(current.revision.id)
}, 60000)

test("review controls stay compact, keyboard accessible and isolated from prototype styles", async () => {
  const current = await published("html")
  await api(`${current.root}/${current.document.id}/revision`, "POST", { name: "Second direction" })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${base}${current.root}/review`)
  const prototype = page.frameLocator("#preview")
  await prototype.getByRole("heading", { name: "Checkout" }).waitFor()
  const before = await prototype.getByRole("button").evaluate((button) => ({
    background: getComputedStyle(button).backgroundColor,
    font: getComputedStyle(button).fontFamily,
  }))
  await page.addStyleTag({
    content: "button { background: rgb(255, 0, 255) !important; font-family: monospace !important }",
  })
  expect(
    await prototype.getByRole("button").evaluate((button) => ({
      background: getComputedStyle(button).backgroundColor,
      font: getComputedStyle(button).fontFamily,
    })),
  ).toEqual(before)
  expect(
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .evaluate((button) => getComputedStyle(button).backgroundColor),
  ).not.toBe("rgb(255, 0, 255)")
  const preview = await page.locator("#preview").boundingBox()
  expect(preview!.y).toBeLessThan(190)
  expect(preview!.height).toBeGreaterThan(600)
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  await page.getByRole("tab", { name: "Conversation", exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  expect(await page.getByRole("tab", { name: "Assets", exact: true }).getAttribute("aria-selected")).toBe("true")
  await page.getByLabel("Seconds", { exact: true }).waitFor()
  await page.getByLabel("Revision", { exact: true }).selectOption(current.revision.id)
  await page.getByRole("button", { name: "Restore as new revision", exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.getByRole("button", { name: "Restore as new revision", exact: true }).isVisible()).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await page.locator("#preview").boundingBox())!.height).toBeGreaterThan(150)
  // The annotation card stays inside a phone-width viewport and never widens the page.
  await page.getByRole("tab", { name: "Conversation", exact: true }).click()
  await annotate(page, true)
  await prototype.getByRole("heading", { name: "Checkout" }).click()
  await page.locator("#card:not([hidden])").waitFor()
  const card = await page.locator("#card").boundingBox()
  expect(card!.x).toBeGreaterThanOrEqual(0)
  expect(card!.x + card!.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.close()
}, 60000)

test("preview failures show the resource, stop repeated requests and recover variants after a new revision", async () => {
  const current = await published("html")
  await Bun.write(
    path.join(current.document.root, current.document.entry),
    '<!doctype html><html><head><link rel="stylesheet" href="missing.css"></head><body><section data-design-variant="a" data-design-label="Variant A"><h1>Variant A</h1></section><section data-design-variant="b" data-design-label="Variant B"><h1>Variant B</h1></section></body></html>',
  )
  const broken = await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", {
    name: "Missing resource",
  })
  const page = await browser.newPage()
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.url().endsWith(`/revision/${broken.id}/preview`)) requests.push(request.url())
  })
  // Without the conversation feed the page still refreshes and recovers by itself.
  await page.route(/\/design\/feed(\?.*)?$/, (route) => route.abort())
  try {
    await page.goto(`${base}${current.root}/review`)
    await page.locator("#preview-error:not([hidden])").waitFor()
    expect(await page.locator("#preview-error").textContent()).toContain("missing.css")
    expect(await page.getByRole("button", { name: "Approve this revision", exact: true }).isDisabled()).toBe(true)
    // Cross the real five-second refresh interval to ensure it doesn't hammer a broken revision.
    await page.waitForTimeout(5500)
    expect(requests).toHaveLength(1)
    await Bun.write(path.join(current.document.root, "missing.css"), "body{color:navy}")
    await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", { name: "Resource restored" })
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    await page.getByRole("tab", { name: "Variant B", exact: true }).click()
    await page.frameLocator("#preview").getByRole("heading", { name: "Variant B" }).waitFor()
    expect(await page.locator("#preview-error").isVisible()).toBe(false)
    expect(await page.getByRole("button", { name: "Approve this revision", exact: true }).isEnabled()).toBe(true)
    await page.locator("#revisions").selectOption(broken.id)
    await page.locator("#preview-error:not([hidden])").waitFor()
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    await page.locator("#refresh:not([disabled])").waitFor()
    expect(await page.locator("#revisions").inputValue()).toBe(broken.id)
    expect(requests).toHaveLength(3)
    expect(await page.getByRole("button", { name: "Approve this revision", exact: true }).isDisabled()).toBe(true)
  } finally {
    await page.close()
  }
}, 60000)

test("conversation shows reply, state and auto-reloads on publish", async () => {
  const current = await published("html")
  const tall = (heading: string) =>
    `<!doctype html><html lang="en"><body><main style="height:3000px"><h1 id="title">${heading}</h1><p id="bottom" style="margin-top:2400px">Footer</p></main></body></html>`
  await Bun.write(path.join(current.document.root, current.document.entry), tall("Checkout"))
  const first = await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", {
    name: "Tall direction",
  })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const canned = [
    { type: "state", seq: 0, at: 1, state: "working" },
    { type: "tool", seq: 4, at: 1, id: "call_1", tool: "design_preview", status: "done", summary: "Design" },
    { type: "reply", seq: 5, at: 1, id: "txt_1", text: "Made the title larger.\n\nAnything else?" },
    { type: "state", seq: 0, at: 2, state: "idle" },
  ]
  await page.route(/\/design\/feed(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: canned.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    }),
  )
  try {
    await page.goto(`${base}${current.root}/review`)
    const frame = page.frameLocator("#preview")
    expect(await page.getByRole("tab", { name: "Conversation", exact: true }).getAttribute("aria-selected")).toBe(
      "true",
    )
    await page.getByText("Made the title larger.", { exact: false }).waitFor()
    await page.getByText("design_preview · done · Design", { exact: true }).waitFor()
    await page.locator("#agent-state").filter({ hasText: "Idle" }).waitFor({ state: "attached" })
    expect(await page.locator("#agent-state").getAttribute("data-state")).toBe("idle")
    await frame.getByRole("heading", { name: "Checkout" }).waitFor()
    await annotate(page, true)
    await frame.getByRole("heading", { name: "Checkout" }).click()
    await page.getByLabel("Note for this element", { exact: true }).fill("Make this bigger")
    await page.getByLabel("Note for this element", { exact: true }).press("Enter")
    await page.getByLabel("Review notes", { exact: true }).fill("Draft in progress")
    await frame.locator("body").evaluate(() => scrollTo(0, 400))
    await page.waitForTimeout(300)
    await Bun.write(path.join(current.document.root, current.document.entry), tall("Checkout v2"))
    const second = await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", {
      name: "Second direction",
    })
    await frame.getByRole("heading", { name: "Checkout v2" }).waitFor({ timeout: 10000 })
    await page.locator("#status").filter({ hasText: "Revision published" }).waitFor()
    expect(await page.getByRole("button", { name: "New revision available", exact: true }).isVisible()).toBe(false)
    await note(page, 'h1 "Checkout"', "Make this bigger").waitFor()
    expect(await page.getByLabel("Review notes", { exact: true }).inputValue()).toBe("Draft in progress")
    const deadline = Date.now() + 5000
    while ((await frame.locator("body").evaluate(() => scrollY)) < 390 && Date.now() < deadline) await Bun.sleep(50)
    expect(await frame.locator("body").evaluate(() => scrollY)).toBeGreaterThanOrEqual(390)
    const sent = page.waitForRequest((request) => request.url().endsWith("/feedback") && request.method() === "POST")
    await page.getByRole("button", { name: "Send to agent", exact: true }).click()
    await page.getByText("Feedback received", { exact: true }).waitFor()
    await page.getByText("You: Draft in progress · 1 note", { exact: true }).waitFor()
    // The note keeps the revision it was drafted on; the message names the revision on screen.
    const payload = (await sent).postDataJSON() as Design.Feedback
    expect(payload.revision).toBe(second.id)
    expect(payload.items[0].revision).toBe(first.id)
    expect(errors).toEqual([])
  } finally {
    await page.close()
  }
  // The real feed replays the sent review and reports the session's state.
  const response = await fetch(`${base}${current.root}/feed?after=0`)
  expect(response.headers.get("content-type")).toContain("text/event-stream")
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  while (!chunks.join("").includes('"type":"user"')) {
    const chunk = await reader.read()
    if (chunk.done) break
    chunks.push(decoder.decode(chunk.value, { stream: true }))
  }
  await reader.cancel()
  const entries = chunks
    .join("")
    .split("\n\n")
    .flatMap((block) => block.split("\n").filter((line) => line.startsWith("data:")))
    .map((line) => JSON.parse(line.slice(5)) as Design.FeedEvent)
  expect(entries[0]).toMatchObject({ type: "agent", agent: "design" })
  expect(entries.some((entry) => entry.type === "state")).toBe(true)
  const review = entries.find((entry) => entry.type === "user")
  expect(review).toMatchObject({ type: "user", text: "Draft in progress", notes: 1 })
  expect(review!.seq).toBeGreaterThan(0)
}, 90000)

test("Params synchronizes wizard and modal, persists scenarios and captures note-time context", async () => {
  const current = await published("html")
  const controls: Design.ParamComponent[] = [
    {
      id: "wizard",
      name: "Wizard",
      selector: "#wizard",
      fields: [
        { id: "step", name: "Current step", type: "number", default: 1, min: 1, max: 3 },
        {
          id: "outcome",
          name: "Simulated outcome",
          type: "select",
          default: "success",
          options: ["success", "error", "loading"],
        },
        {
          id: "result",
          name: "Result state",
          type: "select",
          default: "empty",
          options: ["empty", "populated", "error", "loading"],
        },
      ],
    },
    {
      id: "modal",
      name: "Modal",
      selector: "#modal",
      fields: [
        {
          id: "kind",
          name: "Modal type",
          type: "select",
          default: "confirmation",
          options: ["confirmation", "warning"],
        },
        { id: "cancel", name: "Show Cancel", type: "boolean", default: true },
        { id: "title", name: "Modal title", type: "text", default: "Confirm your choice" },
      ],
    },
  ]
  await Bun.write(
    path.join(current.document.root, current.document.entry),
    Bun.file(new URL("./fixture/design-params.html", import.meta.url)),
  )
  await api(`${current.root}/${current.document.id}`, "PATCH", {
    controls,
    scenarios: [
      {
        id: "wizard-error",
        name: "Error at step two",
        selector: "#result",
        state: "error",
        params: { wizard: { step: 2, outcome: "error" } },
        actions: [{ selector: "#submit", action: "click" }],
      },
    ],
  })
  await api(`${current.root}/${current.document.id}/revision`, "POST", { name: "Interactive scenarios" })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await page.goto(`${base}${current.root}/review`)
    const frame = page.frameLocator("#preview")
    await page.getByRole("tab", { name: "Params", exact: true }).click()
    await frame.getByRole("button", { name: "Next", exact: true }).click()
    await page.waitForFunction(
      () =>
        document.querySelector("#review")!.shadowRoot!.querySelector<HTMLInputElement>("#param-field-step")?.value ===
        "2",
    )
    await frame.getByRole("button", { name: "Previous", exact: true }).click()
    await frame.getByRole("heading", { name: "Step 1 of 3" }).waitFor()
    // The prototype reports its state to the panel asynchronously; wait for the field to settle on
    // "1" so the edit below is not raced by that report.
    await page.waitForFunction(
      () =>
        document.querySelector("#review")!.shadowRoot!.querySelector<HTMLInputElement>("#param-field-step")?.value ===
        "1",
    )
    await page.getByLabel("Current step", { exact: true }).fill("2")
    await page.getByLabel("Current step", { exact: true }).press("Tab")
    await frame.getByRole("heading", { name: "Step 2 of 3" }).waitFor()
    await page.getByLabel("Simulated outcome", { exact: true }).selectOption("error")
    await frame.getByRole("button", { name: "Submit", exact: true }).click()
    await frame.getByText("Something went wrong", { exact: true }).waitFor()
    await page.getByRole("tab", { name: "Conversation", exact: true }).click()
    await annotate(page, true)
    await frame.getByRole("button", { name: "Try again", exact: true }).click()
    await page.getByLabel("Note for this element", { exact: true }).fill("Make the retry action clearer")
    await page.getByLabel("Note for this element", { exact: true }).press("Enter")
    await annotate(page, false)
    await page.getByRole("tab", { name: "Params", exact: true }).click()
    await frame.getByRole("button", { name: "Try again", exact: true }).click()
    await page.getByLabel("Simulated outcome", { exact: true }).selectOption("success")
    await frame.getByRole("button", { name: "Submit", exact: true }).click()
    await frame.getByText("Procedure completed", { exact: true }).waitFor()
    // Picking consumes exactly one click, then restores normal prototype interaction.
    await page.getByLabel("Pick a component in the preview", { exact: true }).check()
    await frame.getByRole("button", { name: "OK", exact: true }).click()
    await page.getByLabel("Modal type", { exact: true }).selectOption("warning")
    await page.getByLabel("Show Cancel", { exact: true }).uncheck()
    await frame.getByRole("button", { name: "Cancel", exact: true }).waitFor({ state: "hidden" })
    await frame.getByRole("button", { name: "OK", exact: true }).click()
    await frame.getByRole("heading", { name: "Acknowledged", exact: true }).waitFor()
    await page.getByRole("tab", { name: "Conversation", exact: true }).click()
    const feedback = page.waitForRequest(
      (request) => request.url().endsWith("/feedback") && request.method() === "POST",
    )
    await page.getByRole("button", { name: "Send to agent", exact: true }).click()
    const body = (await feedback).postDataJSON() as Design.Feedback
    expect(body.items[0]).toMatchObject({
      target: "#retry",
      tag: "button",
      label: 'button "Try again"',
      text: "Make the retry action clearer",
    })
    expect(body.items[0].params?.values.wizard).toMatchObject({ step: 2, outcome: "error", result: "error" })
    expect(body.params?.values.wizard.result).toBe("populated")
    await page.getByText("Feedback received", { exact: true }).waitFor()
    await page.getByRole("tab", { name: "Params", exact: true }).click()
    await page.getByLabel("Scenario name", { exact: true }).fill("Warning after success")
    await page.getByRole("button", { name: "Save scenario", exact: true }).click()
    await page.getByText("Scenario saved in a new revision", { exact: true }).waitFor()
    await page.reload()
    await page.getByRole("tab", { name: "Params", exact: true }).click()
    await page.getByLabel("Scenario", { exact: true }).selectOption({ label: "Warning after success" })
    await frame.getByRole("heading", { name: "Acknowledged", exact: true }).waitFor()
    await page.getByLabel("Component", { exact: true }).selectOption("wizard")
    await frame.getByRole("button", { name: "Next", exact: true }).click()
    await frame.getByRole("heading", { name: "Step 3 of 3" }).waitFor()
    await page.getByRole("button", { name: "Restart scenario", exact: true }).click()
    await frame.getByRole("heading", { name: "Step 2 of 3" }).waitFor()
    // Values outside declared bounds and messages from the wrong window are ignored.
    await page.evaluate(() =>
      window.postMessage({ type: "design:params-state", values: { wizard: { step: 99 } } }, "*"),
    )
    expect(await page.getByLabel("Current step", { exact: true }).inputValue()).toBe("2")
    const saved = await api<Design.Info>(`${current.root}/${current.document.id}`)
    expect(saved.presets?.[0].values.modal.cancel).toBe(false)
    expect(saved.presets?.[0].values.wizard.step).toBe(2)
    const job = await api<Design.Job>(`${current.root}/${current.document.id}/job`, "POST", {
      revision: saved.revision,
      format: "audit",
    })
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      const jobs = await api<Design.Job[]>(`${current.root}/${current.document.id}/job`)
      const done = jobs.find((item) => item.id === job.id)!
      if (done.status === "failed") throw new Error(done.error ?? "Design audit failed")
      if (done.status === "completed") {
        expect(
          done.audit?.scenarios.some((item) => item.includes("Error at step two") && item.includes("exercised")),
        ).toBe(true)
        break
      }
      await Bun.sleep(200)
    }
    expect(Date.now()).toBeLessThan(deadline)
    expect(errors).toEqual([])
    const favicon = await page.locator('link[rel="icon"]').getAttribute("href")
    expect(decodeURIComponent(favicon!)).toContain("<title>RedDB</title>")
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.querySelector("#review")!).getPropertyValue("--accent").trim(),
      ),
    ).toBe("#ff2056")
    await page.screenshot({ path: path.join(temporary, "redcode-design-params.png") })
    await page.emulateMedia({ colorScheme: "dark" })
    await page.waitForFunction(() => document.querySelector<HTMLElement>("#review")!.dataset.colorScheme === "dark")
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#review")!).backgroundColor)).toBe(
      "rgb(18, 20, 27)",
    )
    await page.screenshot({ path: path.join(temporary, "redcode-design-params-dark.png") })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByLabel("Current step", { exact: true }).fill("1")
    await page.getByLabel("Current step", { exact: true }).press("Tab")
    await frame.getByRole("heading", { name: "Step 1 of 3" }).waitFor()
    await page.screenshot({ path: path.join(temporary, "redcode-design-params-mobile.png") })
  } finally {
    await page.close()
  }
}, 120000)

test("Params component picking respects variant scope and rejects invalid runtime values", async () => {
  const current = await published("html")
  const controls: Design.ParamComponent[] = ["a", "b"].map((variant) => ({
    id: `card-${variant}`,
    name: `Card ${variant}`,
    selector: ".card",
    variant,
    fields: [{ id: "quantity", name: "Quantity", type: "number", default: 1, min: 1, max: 3 }],
  }))
  await api(`${current.root}/${current.document.id}`, "PATCH", { controls })
  await Bun.write(
    path.join(current.document.root, current.document.entry),
    '<!doctype html><html><body><section data-design-variant="a" data-design-label="Option A"><article class="card"><h2>Card A</h2></article></section><section data-design-variant="b" data-design-label="Option B"><article class="card"><h2>Card B</h2></article></section></body></html>',
  )
  await api(`${current.root}/${current.document.id}/revision`, "POST", { name: "Scoped components" })
  const page = await browser.newPage()
  try {
    await page.goto(`${base}${current.root}/review`)
    await page.getByRole("tab", { name: "Option B", exact: true }).click()
    await page.getByRole("tab", { name: "Params", exact: true }).click()
    await page.getByLabel("Pick a component in the preview", { exact: true }).check()
    await page.frameLocator("#preview").getByRole("heading", { name: "Card B", exact: true }).click()
    await page.waitForFunction(
      () =>
        document.querySelector("#review")!.shadowRoot!.querySelector<HTMLInputElement>("#param-select")?.checked ===
        false,
    )
    expect(await page.getByLabel("Component", { exact: true }).inputValue()).toBe("card-b")
    const frame = await (await page.locator("#preview").elementHandle())!.contentFrame()
    await frame!.evaluate(() =>
      window.dispatchEvent(new CustomEvent("design:state", { detail: { values: { "card-b": { quantity: 99 } } } })),
    )
    expect(await page.getByLabel("Quantity", { exact: true }).inputValue()).toBe("1")
    await page.getByLabel("Quantity", { exact: true }).fill("3")
    await page.getByLabel("Quantity", { exact: true }).press("Tab")
    await page.getByRole("tab", { name: "Conversation", exact: true }).click()
    await page.reload()
    await page.getByRole("tab", { name: "Option B", exact: true }).click()
    await page.getByRole("tab", { name: "Params", exact: true }).click()
    await page.waitForFunction(
      () =>
        document.querySelector("#review")!.shadowRoot!.querySelector<HTMLInputElement>("#param-field-quantity")
          ?.value === "3",
    )
  } finally {
    await page.close()
  }
}, 30000)

test("annotation card keyboard map and reveal", async () => {
  const current = await published("html")
  await Bun.write(
    path.join(current.document.root, current.document.entry),
    '<!doctype html><html lang="en"><body><main style="height:3000px"><h1 id="title">Checkout</h1><p id="bottom" tabindex="0" style="margin-top:2400px">Footer</p></main></body></html>',
  )
  await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", { name: "Tall direction" })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await page.goto(`${base}${current.root}/review`)
    const frame = page.frameLocator("#preview")
    const card = page.getByLabel("Note for this element", { exact: true })
    await annotate(page, true)
    await frame.getByRole("heading", { name: "Checkout" }).click()
    await page.locator("#card:not([hidden])").waitFor()
    expect(await page.locator("#card-label").textContent()).toBe('h1 "Checkout"')
    expect(await activeID(page)).toBe("card-text")
    // A design:key that does not come from the preview frame is ignored.
    await page.evaluate(() => window.postMessage({ type: "design:key", key: "Escape" }, "*"))
    await page.waitForTimeout(200)
    expect(await page.locator("#card").isHidden()).toBe(false)
    // The card opens over the element it describes, inside the parent document.
    const heading = await frame.getByRole("heading", { name: "Checkout" }).boundingBox()
    const box = await page.locator("#card").boundingBox()
    expect(box!.y).toBeGreaterThan(heading!.y)
    expect(Math.abs(box!.x - heading!.x)).toBeLessThan(40)
    expect(await frame.locator("#card").count()).toBe(0)
    await card.pressSequentially("Line one")
    await card.press("Shift+Enter")
    await card.pressSequentially("line two")
    expect(await card.inputValue()).toBe("Line one\nline two")
    // The unfinished card survives a reload and re-anchors to its element.
    await page.reload()
    await page.locator("#card:not([hidden])").waitFor()
    expect(await card.inputValue()).toBe("Line one\nline two")
    expect(await page.locator("#card-label").textContent()).toBe('h1 "Checkout"')
    await annotate(page, true)
    await card.press("Enter")
    await note(page, 'h1 "Checkout"', "Line one").waitFor()
    await page.locator("#card").waitFor({ state: "hidden" })
    // Escape closes an empty card, also when pressed inside the prototype.
    await frame.locator("#bottom").click()
    await page.locator("#card:not([hidden])").waitFor()
    expect(await page.locator("#card-label").textContent()).toBe('p "Footer"')
    await card.press("Escape")
    await page.locator("#card").waitFor({ state: "hidden" })
    await frame.locator("#bottom").click()
    await page.locator("#card:not([hidden])").waitFor()
    await frame.locator("#bottom").press("Escape")
    await page.locator("#card").waitFor({ state: "hidden" })
    // With text in it Escape only leaves the card; Ctrl+Enter queues the note and sends everything.
    await frame.getByRole("heading", { name: "Checkout" }).click()
    await card.fill("Send me now")
    await card.press("Escape")
    expect(await page.locator("#card").isHidden()).toBe(false)
    expect(await activeID(page)).not.toBe("card-text")
    // Picking another element carries the typed note along and says so.
    await frame.locator("#bottom").click()
    await page.locator("#card-label", { hasText: 'p "Footer"' }).waitFor()
    expect(await card.inputValue()).toBe("Send me now")
    await page.locator("#status").filter({ hasText: 'Note moved to p "Footer"' }).waitFor()
    await frame.getByRole("heading", { name: "Checkout" }).click()
    await page.locator("#card-label", { hasText: 'h1 "Checkout"' }).waitFor()
    await card.focus()
    const sent = page.waitForRequest((request) => request.url().endsWith("/feedback") && request.method() === "POST")
    await card.press("Control+Enter")
    await page.getByText("Feedback received", { exact: true }).waitFor()
    const payload = (await sent).postDataJSON() as Design.Feedback
    expect(payload.delivery).toBe("steer")
    expect(payload.end).toBe(false)
    expect(payload.items).toHaveLength(2)
    expect(payload.items[0]).toMatchObject({
      target: "#title",
      text: "Line one\nline two",
      tag: "h1",
      elementText: "Checkout",
      label: 'h1 "Checkout"',
    })
    expect(payload.items[1]).toMatchObject({ target: "#title", text: "Send me now", label: 'h1 "Checkout"' })
    expect(await page.locator("#notes .note").count()).toBe(0)
    // Reveal scrolls the prototype to the note's element and pulses it; hovering highlights it.
    await frame.locator("#bottom").click()
    await card.fill("Footer note")
    await card.press("Enter")
    await frame.locator("body").evaluate(() => scrollTo(0, 0))
    const row = note(page, 'p "Footer"', "Footer note")
    await row.hover()
    await frame.locator("#bottom[data-design-highlight]").waitFor()
    await row.getByRole("button", { name: "Reveal", exact: true }).click()
    await frame.locator("#bottom[data-design-reveal]").waitFor()
    const scrolled = Date.now() + 5000
    while ((await frame.locator("body").evaluate(() => scrollY)) < 1000 && Date.now() < scrolled) await Bun.sleep(50)
    expect(await frame.locator("body").evaluate(() => scrollY)).toBeGreaterThan(1000)
    // Ctrl+Enter in an empty card still sends the notes already queued.
    await frame.getByRole("heading", { name: "Checkout" }).click()
    await page.locator("#card:not([hidden])").waitFor()
    expect(await card.inputValue()).toBe("")
    const again = page.waitForRequest((request) => request.url().endsWith("/feedback") && request.method() === "POST")
    const answered = page.waitForResponse((response) => response.url().endsWith("/feedback"))
    await card.press("Control+Enter")
    expect((await again).postDataJSON().items).toMatchObject([{ target: "#bottom", text: "Footer note" }])
    await answered
    await page.locator("#card").waitFor({ state: "hidden" })
    await page.locator("#notes .note").first().waitFor({ state: "detached" })
    // Remove drops a queued note.
    await frame.getByRole("heading", { name: "Checkout" }).click()
    await card.fill("Remove me")
    await card.press("Enter")
    await note(page, 'h1 "Checkout"', "Remove me").getByRole("button", { name: "Remove", exact: true }).click()
    expect(await page.locator("#notes .note").count()).toBe(0)
    // A newer revision without the element closes the card anchored to it.
    await frame.locator("#bottom").click()
    await card.fill("Gone soon")
    await Bun.write(
      path.join(current.document.root, current.document.entry),
      '<!doctype html><html lang="en"><body><main><h1 id="title">Checkout v2</h1></main></body></html>',
    )
    await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", { name: "Without footer" })
    await frame.getByRole("heading", { name: "Checkout v2" }).waitFor({ timeout: 10000 })
    await page.locator("#card").waitFor({ state: "hidden" })
    expect(errors).toEqual([])
  } finally {
    await page.close()
  }
}, 90000)

test("layout inbox queue/dismiss/resolve", async () => {
  const current = await published("html")
  const wide = (banner: number, promo: number) =>
    `<!doctype html><html lang="en"><body><main><h1 id="title">Checkout</h1><p id="banner" style="width:${banner}px">Banner</p><p id="promo" style="width:${promo}px">Promo</p><p id="tight" style="width:600px">Tight</p><button id="cta" style="margin-left:2600px">Buy</button></main></body></html>`
  await Bun.write(path.join(current.document.root, current.document.entry), wide(3000, 3000))
  await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", { name: "Wide direction" })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const finding = (label: string) => page.locator("#inbox .finding").filter({ hasText: label })
  try {
    await page.goto(`${base}${current.root}/review`)
    const frame = page.frameLocator("#preview")
    await page.locator("#inbox-count").filter({ hasText: "3" }).waitFor()
    expect(await page.locator("#panel-details").textContent()).not.toContain("Layout observations")
    await page.locator("#inbox summary").click()
    expect(await finding('p "Banner"').getAttribute("data-severity")).toBe("warn")
    expect(await finding('p "Banner"').getAttribute("data-status")).toBe("open")
    // A tick survives the re-audit a resize triggers, whether or not it lists something new.
    await finding('p "Banner"').getByRole("checkbox").check()
    await page.getByLabel("Preview width", { exact: true }).selectOption("768")
    expect(await frame.locator("body").evaluate(() => innerWidth)).toBe(768)
    await page.getByLabel("Preview width", { exact: true }).selectOption("390")
    await finding('p "Tight"').waitFor()
    expect(await finding('p "Banner"').getByRole("checkbox").isChecked()).toBe(true)
    await page.getByLabel("Preview width", { exact: true }).selectOption("100%")
    expect(await finding('p "Banner"').getByRole("checkbox").isChecked()).toBe(true)
    // Queuing turns the ticked observations into notes in one step.
    await page.getByRole("button", { name: "Queue selected fixes", exact: true }).click()
    await note(page, 'p "Banner"', "Element extends beyond the viewport").waitFor()
    expect(await finding('p "Banner"').getAttribute("data-status")).toBe("queued")
    expect(await page.locator("#notes .note").count()).toBe(1)
    await finding('button "Buy"').getByRole("button", { name: "Dismiss", exact: true }).click()
    expect(await finding('button "Buy"').count()).toBe(0)
    expect(await page.locator("#inbox-count").textContent()).toBe("2")
    // The lifecycle and the dismissal survive a reload of the page.
    await page.reload()
    await note(page, 'p "Banner"', "Element extends beyond the viewport").waitFor()
    await page.locator("#inbox summary").click()
    await finding('p "Promo"').waitFor()
    await page.locator('#inbox .finding[data-status="queued"]').filter({ hasText: 'p "Banner"' }).waitFor()
    await page.locator("#inbox-count", { hasText: /^2$/ }).waitFor()
    expect(await finding('button "Buy"').count()).toBe(0)
    await finding('p "Promo"').getByRole("button", { name: "Reveal", exact: true }).click()
    await frame.locator("#promo[data-design-reveal]").waitFor()
    // A newer revision fixes Promo and still overflows Banner: one resolves, the other reopens.
    await Bun.write(path.join(current.document.root, current.document.entry), wide(3000, 100))
    await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", { name: "Narrower" })
    await page.locator("#status").filter({ hasText: "Revision published" }).waitFor({ timeout: 10000 })
    await page.locator('#inbox .finding[data-status="resolved"]').filter({ hasText: 'p "Promo"' }).waitFor()
    await page.locator('#inbox .finding[data-status="resolved"]').filter({ hasText: 'p "Tight"' }).waitFor()
    await page.locator('#inbox .finding[data-status="open"]').filter({ hasText: 'p "Banner"' }).waitFor()
    expect(await page.locator("#inbox-count").textContent()).toBe("1")
    expect(await finding('button "Buy"').count()).toBe(0)
    expect(await page.locator("#notes .note").count()).toBe(1)
    // Queuing a reopened finding whose note is still waiting does not duplicate the note.
    await finding('p "Banner"').getByRole("checkbox").check()
    await page.getByRole("button", { name: "Queue selected fixes", exact: true }).click()
    await page.locator('#inbox .finding[data-status="queued"]').filter({ hasText: 'p "Banner"' }).waitFor()
    expect(await page.locator("#notes .note").count()).toBe(1)
    // Send & end delivers the queued note with its element context and closes the review.
    const sent = page.waitForRequest((request) => request.url().endsWith("/feedback") && request.method() === "POST")
    await page.getByRole("button", { name: "Send & end", exact: true }).click()
    await page.getByText("Feedback received", { exact: true }).waitFor()
    const payload = (await sent).postDataJSON() as Design.Feedback
    expect(payload.delivery).toBe("steer")
    expect(payload.end).toBe(true)
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({
      target: "#banner",
      tag: "p",
      label: 'p "Banner"',
      text: "Element extends beyond the viewport",
    })
    expect(payload.items[0].params?.values).toEqual({})
    await page.getByRole("button", { name: "Reopen review" }).waitFor()
    expect(errors).toEqual([])
  } finally {
    await page.close()
  }
}, 90000)

test("compact toolbar keeps every action reachable", async () => {
  const current = await published("solid")
  const second = await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", {
    name: "Second direction",
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await page.goto(`${base}${current.root}/review`)
    await page.getByRole("tab", { name: "Spacious", exact: true }).waitFor()
    // Two rows: the toolbar and the variant strip, together under 80px.
    const toolbar = (await page.locator("#toolbar").boundingBox())!
    const strip = (await page.locator("#studio .variant-bar").boundingBox())!
    expect(toolbar.height + strip.height).toBeLessThanOrEqual(80)
    expect(strip.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 1)
    expect((await page.locator("#preview").boundingBox())!.y).toBeLessThan(100)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    // Every control keeps its accessible name in the compact layout.
    for (const name of [
      "Refresh",
      "Add variant",
      "Single view",
      "Side by side",
      "Approve this revision",
      "More actions",
      "Annotate elements",
    ])
      expect(await page.getByRole("button", { name, exact: true }).isVisible()).toBe(true)
    expect(await page.getByRole("button", { name: "Single view", exact: true }).getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(await page.getByLabel("Preview width", { exact: true }).isVisible()).toBe(true)
    expect(await page.getByLabel("Revision", { exact: true }).isVisible()).toBe(true)
    expect(await page.locator("#agent-state").isVisible()).toBe(false)
    expect(await page.getByRole("button", { name: "Restore as new revision", exact: true }).isVisible()).toBe(false)
    // Browsing an older revision adds Restore and the newer-revision pill without a third row.
    await showsRevision(page, second.id)
    await page.getByLabel("Revision", { exact: true }).selectOption(current.revision.id)
    await page.getByRole("button", { name: "Restore as new revision", exact: true }).waitFor()
    await page.getByRole("button", { name: "New revision available", exact: true }).waitFor()
    expect(
      (await page.locator("#toolbar").boundingBox())!.height +
        (await page.locator("#studio .variant-bar").boundingBox())!.height,
    ).toBeLessThanOrEqual(80)
    // The overflow menu opens from the keyboard, moves focus into it and returns focus on Escape.
    const more = page.getByRole("button", { name: "More actions", exact: true })
    await more.focus()
    await page.keyboard.press("Enter")
    await page.getByRole("menu").waitFor()
    expect(await more.getAttribute("aria-expanded")).toBe("true")
    expect(await activeID(page)).toBe("new")
    await page.keyboard.press("ArrowDown")
    expect(await activeID(page)).toBe("menu-refresh")
    await page.keyboard.press("Escape")
    await page.getByRole("menu").waitFor({ state: "hidden" })
    expect(await activeID(page)).toBe("more")
    expect(await more.getAttribute("aria-expanded")).toBe("false")
    // An outside pointer closes it too.
    await more.click()
    await page.getByRole("menu").waitFor()
    await page.mouse.click(700, 500)
    await page.getByRole("menu").waitFor({ state: "hidden" })
    // Refresh, Add variant and Create design all work through the menu.
    await more.click()
    await page.getByRole("menuitem", { name: "Refresh", exact: true }).click()
    await page.locator("#status").filter({ hasText: "Preview refreshed" }).waitFor()
    await page.getByRole("menu").waitFor({ state: "hidden" })
    await more.click()
    await page.getByRole("menuitem", { name: "Add variant", exact: true }).click()
    await page.getByLabel("What should the new variant explore?").waitFor()
    await page.locator("#cancel-variant").click()
    // At phone width the open menu stays inside the viewport and never widens the page.
    await page.setViewportSize({ width: 390, height: 844 })
    await more.click()
    await page.getByRole("menu").waitFor()
    const box = (await page.getByRole("menu").boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    // Home and End jump to the first and last entries, and Tab leaves the menu closed.
    await page.keyboard.press("End")
    expect(await activeID(page)).toBe("menu-add-variant")
    await page.keyboard.press("Home")
    expect(await activeID(page)).toBe("new")
    await page.keyboard.press("Tab")
    await page.getByRole("menu").waitFor({ state: "hidden" })
    expect(await more.getAttribute("aria-expanded")).toBe("false")
    // ArrowUp on the trigger opens the menu on its last entry.
    await more.focus()
    await page.keyboard.press("ArrowUp")
    await page.getByRole("menu").waitFor()
    expect(await activeID(page)).toBe("menu-add-variant")
    await page.keyboard.press("Escape")
    await page.getByRole("menu").waitFor({ state: "hidden" })
    await page.setViewportSize({ width: 1440, height: 900 })
    // Create design opens the brief and focus moves into it rather than back to the trigger.
    await more.click()
    await page.getByRole("menuitem", { name: "Create design", exact: true }).click()
    await page.getByLabel("Name", { exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector("#review")!.shadowRoot!.activeElement?.id === "name")
    expect(await page.getByLabel("Revision", { exact: true }).isVisible()).toBe(false)
    expect(await page.getByRole("button", { name: "Approve this revision", exact: true }).isVisible()).toBe(false)
    expect(await page.getByRole("button", { name: "Refresh", exact: true }).isVisible()).toBe(true)
  } finally {
    await page.close()
  }
}, 60000)

test("annotate toggle stays in the toolbar and responds to A", async () => {
  const current = await published("html")
  await Bun.write(
    path.join(current.document.root, current.document.entry),
    `<!doctype html><html lang="en"><body>
    <section data-design-variant="graphite" data-design-label="Graphite"><h1 id="title">Checkout</h1><input id="field" aria-label="Coupon"><div id="editable" contenteditable="true">Editable</div></section>
    <section data-design-variant="stone" data-design-label="Stone"><h1>Stone checkout</h1></section>
    </body></html>`,
  )
  await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", { name: "Two directions" })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  // A long conversation must not push the annotation control out of reach.
  const canned = Array.from({ length: 40 }, (_, index) => ({
    type: "reply",
    seq: index + 1,
    at: 1,
    id: `txt_${index}`,
    text: `Reply number ${index}\n\nA longer paragraph so the conversation grows well past the panel height.`,
  }))
  await page.route(/\/design\/feed(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: canned.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    }),
  )
  const pressed = (value: boolean) =>
    page.waitForFunction(
      (expected) =>
        document.querySelector("#review")!.shadowRoot!.querySelector("#annotate")!.getAttribute("aria-pressed") ===
        String(expected),
      value,
      { timeout: 5000 },
    )
  try {
    await page.goto(`${base}${current.root}/review`)
    const frame = page.frameLocator("#preview")
    await frame.getByRole("heading", { name: "Checkout" }).waitFor()
    await page.getByText("Reply number 39", { exact: false }).waitFor()
    const toggle = page.getByRole("button", { name: "Annotate elements", exact: true })
    expect(await toggle.isVisible()).toBe(true)
    expect(await toggle.getAttribute("title")).toBe("Annotate elements (A)")
    expect(await toggle.getAttribute("aria-pressed")).toBe("false")
    const box = (await toggle.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(80)
    // The toggle fits the two-row budget of the toolbar and the variant strip.
    await page.getByRole("tab", { name: "Stone", exact: true }).waitFor()
    expect(
      (await page.locator("#toolbar").boundingBox())!.height +
        (await page.locator("#studio .variant-bar").boundingBox())!.height,
    ).toBeLessThanOrEqual(80)
    // It sits before Approve in the actions group and the panel no longer has a checkbox.
    expect(
      (await page.getByRole("button", { name: "Approve this revision", exact: true }).boundingBox())!.x,
    ).toBeGreaterThan(box.x)
    expect(await page.getByRole("checkbox", { name: "Annotate elements" }).count()).toBe(0)
    expect(await page.locator("aside #annotate").count()).toBe(0)
    // Click toggles.
    await toggle.click()
    await pressed(true)
    await toggle.click()
    await pressed(false)
    // A toggles from the toolbar and from a page with nothing focused.
    await page.keyboard.press("a")
    await pressed(true)
    await page.evaluate(() => (document.querySelector("#review")!.shadowRoot!.activeElement as HTMLElement)?.blur())
    await page.keyboard.press("A")
    await pressed(false)
    // Typing A in the notes never toggles.
    const notes = page.getByLabel("Review notes", { exact: true })
    await notes.fill("")
    await notes.press("a")
    await page.waitForTimeout(200)
    expect(await toggle.getAttribute("aria-pressed")).toBe("false")
    expect(await notes.inputValue()).toBe("a")
    // Not while the overflow menu is open either.
    await page.getByRole("button", { name: "More actions", exact: true }).click()
    await page.getByRole("menu").waitFor()
    await page.keyboard.press("a")
    await page.waitForTimeout(200)
    expect(await toggle.getAttribute("aria-pressed")).toBe("false")
    await page.keyboard.press("Escape")
    await page.getByRole("menu").waitFor({ state: "hidden" })
    // Escape ends annotation.
    await toggle.click()
    await pressed(true)
    await page.keyboard.press("Escape")
    await pressed(false)
    // Select-all and other modified keys are left alone.
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Meta+a")
    await page.waitForTimeout(200)
    expect(await toggle.getAttribute("aria-pressed")).toBe("false")
    // Keys pressed inside the preview are forwarded: A turns it on, Escape turns it off.
    await frame.locator("body").press("a")
    await pressed(true)
    await frame.locator("body").press("Escape")
    await pressed(false)
    // Typing into the prototype's own fields never toggles, and Escape there is not forwarded.
    await frame.locator("#field").press("a")
    await frame.locator("#editable").press("a")
    await page.waitForTimeout(200)
    expect(await toggle.getAttribute("aria-pressed")).toBe("false")
    expect(await frame.locator("#field").inputValue()).toBe("a")
    await annotate(page, true)
    await frame.locator("#field").focus()
    await frame.locator("#field").press("Escape")
    await page.waitForTimeout(200)
    expect(await toggle.getAttribute("aria-pressed")).toBe("true")
    // With a card open, Escape closes the card first, annotation stays on and focus lands on the toggle.
    await frame.getByRole("heading", { name: "Checkout" }).click()
    await page.locator("#card:not([hidden])").waitFor()
    await page.getByLabel("Note for this element", { exact: true }).press("Escape")
    await page.locator("#card").waitFor({ state: "hidden" })
    expect(await toggle.getAttribute("aria-pressed")).toBe("true")
    expect(await activeID(page)).toBe("annotate")
    await page.keyboard.press("Escape")
    await pressed(false)
    // Adding a note also hands focus back to the toggle.
    await annotate(page, true)
    await frame.getByRole("heading", { name: "Checkout" }).click()
    const card = page.getByLabel("Note for this element", { exact: true })
    await card.fill("Bigger title")
    await card.press("Enter")
    await page.locator("#card").waitFor({ state: "hidden" })
    expect(await activeID(page)).toBe("annotate")
    // A card left open with text keeps A from toggling even once focus has left it.
    await frame.getByRole("heading", { name: "Checkout" }).click()
    await card.fill("Still writing")
    await card.press("Escape")
    expect(await activeID(page)).not.toBe("card-text")
    await page.keyboard.press("a")
    await page.waitForTimeout(200)
    expect(await toggle.getAttribute("aria-pressed")).toBe("true")
    await page.getByRole("button", { name: "Close note", exact: true }).click()
    await page.locator("#card").waitFor({ state: "hidden" })
    await annotate(page, false)
    // While comparing, the second frame forwards the keys too.
    await page.getByRole("button", { name: "Side by side", exact: true }).click()
    const peer = page.frameLocator("#peer-preview")
    await peer.locator("section").first().waitFor({ state: "attached" })
    await peer.locator("body").press("a")
    await pressed(true)
    await peer.locator("body").press("Escape")
    await pressed(false)
    await page.getByRole("button", { name: "Single view", exact: true }).click()
    // At phone width the control collapses to its icon and neither the toolbar nor the page overflows.
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await toggle.isVisible()).toBe(true)
    expect(await page.locator("#annotate .label").isVisible()).toBe(false)
    expect(await page.locator("#toolbar").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await toggle.click()
    await pressed(true)
    expect(errors).toEqual([])
  } finally {
    await page.close()
  }
}, 60000)

test("a revision picked while a refresh is in flight stays on screen", async () => {
  const current = await published("html")
  const second = await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", {
    name: "Second direction",
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await page.goto(`${base}${current.root}/review`)
    await page.frameLocator("#preview").getByRole("heading", { name: "Checkout" }).waitFor()
    await showsRevision(page, second.id)
    // Hold the revision list of the next background poll so the pick lands while it is in flight.
    const stalled = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    await page.route(
      (url) => url.pathname.endsWith("/revision"),
      async (route) => {
        if (route.request().method() === "GET") {
          stalled.resolve()
          await release.promise
        }
        await route.continue()
      },
    )
    await Promise.race([
      stalled.promise,
      Bun.sleep(8000).then(() => {
        throw new Error("No background poll requested the revision list within 8 seconds")
      }),
    ])
    await page.getByLabel("Revision", { exact: true }).selectOption(current.revision.id)
    release.resolve()
    await page.getByRole("button", { name: "Restore as new revision", exact: true }).waitFor({ timeout: 5000 })
    await showsRevision(page, current.revision.id)
    // The next poll keeps the older revision: the newer one is only offered. Refresh asks for the
    // assets only after it has settled the revision select.
    await page.waitForRequest((request) => request.url().endsWith("/revision") && request.method() === "GET", {
      timeout: 8000,
    })
    await page.waitForRequest((request) => request.url().endsWith("/asset") && request.method() === "GET", {
      timeout: 8000,
    })
    expect(await page.getByLabel("Revision", { exact: true }).inputValue()).toBe(current.revision.id)
    expect(await page.getByRole("button", { name: "Restore as new revision", exact: true }).isVisible()).toBe(true)
    expect(await page.getByRole("button", { name: "New revision available", exact: true }).isVisible()).toBe(true)
  } finally {
    await page.close()
  }
}, 60000)
