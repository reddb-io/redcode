import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { chromium, type Browser } from "playwright-core"
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
      ? '<!doctype html><html lang="en"><head><title>Checkout</title></head><body><main><h1 id="title">Checkout</h1><button id="submit" onclick="this.textContent=\'Added\';this.dataset.state=\'populated\'" data-state="empty">Add item</button></main></body></html>'
      : 'import { render } from "solid-js/web"; import { createSignal } from "solid-js"; const App=()=>{const [added,setAdded]=createSignal(false);return <main><section data-design-variant="compact" data-design-label="Compact"><h1>Checkout</h1><button onClick={()=>setAdded(true)}>{added()?"Added":"Add item"}</button></section><section data-design-variant="spacious" data-design-label="Spacious"><h1>Spacious checkout</h1></section></main>};render(()=><App />,document.getElementById("root")!)',
  )
  const revision = await api<Design.Revision>(`${root}/${document.id}/revision`, "POST", { name: "First direction" })
  return { document, revision, root, sessionID: current.data.id }
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
  await page.getByRole("button", { name: "Create design", exact: true }).first().click()
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
  await page.getByLabel("Annotate elements", { exact: true }).check()
  await frame.getByRole("heading", { name: "Checkout" }).click()
  await page.getByLabel("Review notes", { exact: true }).fill("Make this title more prominent")
  await page.getByRole("button", { name: "Add note", exact: true }).click()
  await page.reload()
  await page.getByText("#title: Make this title more prominent", { exact: false }).waitFor()
  const feedback: unknown[] = []
  await page.route("**/feedback", async (route) => {
    feedback.push(route.request().postDataJSON())
    const response = await route.fetch()
    if (feedback.length === 1) {
      await route.abort("failed")
      return
    }
    await route.fulfill({ response })
  })
  await page.getByRole("button", { name: "Send feedback", exact: true }).click()
  await page.getByRole("button", { name: "Retry sending saved feedback" }).click()
  await page.getByText("Feedback received", { exact: true }).waitFor()
  expect(feedback).toHaveLength(2)
  expect(feedback[1]).toEqual(feedback[0])
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
  const page = await browser.newPage()
  await page.goto(`${base}${current.root}/review`)
  const frame = page.frameLocator("#preview")
  await frame.getByRole("button", { name: "Add item" }).click()
  expect(await frame.getByRole("button", { name: "Added" }).textContent()).toBe("Added")
  await page.getByRole("tab", { name: "Spacious", exact: true }).click()
  await frame.getByRole("heading", { name: "Spacious checkout" }).waitFor()
  expect(await frame.getByRole("heading", { name: "Checkout", exact: true }).isVisible()).toBe(false)
  await page.getByRole("button", { name: "Restore as new revision" }).click()
  await page.getByRole("option", { name: /Restored: First direction/ }).waitFor({ state: "attached" })
  const revisions = await api<Design.Revision[]>(`${current.root}/${current.document.id}/revision`)
  expect(revisions).toHaveLength(2)
  expect(revisions[0].parent).toBe(current.revision.id)
  await page.close()
}, 90000)

test("refresh reloads the preview and keeps request errors visible across polling", async () => {
  const current = await published("html")
  const page = await browser.newPage()
  try {
    await page.goto(`${base}${current.root}/review`)
    const frame = page.frameLocator("#preview")
    await frame.getByRole("button", { name: "Add item" }).click()
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    await frame.getByRole("button", { name: "Add item" }).waitFor({ timeout: 3000 })
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
  const assets = Promise.withResolvers<void>()
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
    await page.route("**/asset", async (route) => {
      await assets.promise
      await route.continue()
    })
    await Bun.write(
      path.join(current.document.root, current.document.entry),
      `<!doctype html><html><body><section data-design-variant="warm" data-design-label="Warm"><h1>Warm checkout</h1></section></body></html>`,
    )
    await api<Design.Revision>(`${current.root}/${current.document.id}/revision`, "POST", { name: "Warmer direction" })
    await page.getByRole("button", { name: "New revision available", exact: true }).waitFor()
    expect(await page.getByRole("button", { name: "Approve this revision" }).isDisabled()).toBe(true)
    assets.resolve()
    await page.getByRole("button", { name: "New revision available", exact: true }).click()
    await page.getByRole("tab", { name: "Warm", exact: true }).waitFor()
    await preview.getByRole("heading", { name: "Warm checkout" }).waitFor()
    await page.getByLabel("Revision", { exact: true }).selectOption(revision.id)
    await page.getByRole("tab", { name: "Stone", exact: true }).waitFor()
    expect(await page.getByLabel("Review notes", { exact: true }).inputValue()).toBe("Keep my unsent notes")
  } finally {
    assets.resolve()
    await page.close()
  }
}, 60000)

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
  await page.getByText("diagram: Keep these steps clear", { exact: false }).waitFor({ timeout: 60000 })
  await page.getByRole("button", { name: "Send feedback", exact: true }).click()
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
      .getByRole("button", { name: "Create design", exact: true })
      .evaluate((button) => getComputedStyle(button).backgroundColor),
  ).not.toBe("rgb(255, 0, 255)")
  const preview = await page.locator("#preview").boundingBox()
  expect(preview!.y).toBeLessThan(190)
  expect(preview!.height).toBeGreaterThan(600)
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  await page.getByRole("tab", { name: "Review", exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  expect(await page.getByRole("tab", { name: "Assets", exact: true }).getAttribute("aria-selected")).toBe("true")
  await page.getByLabel("Seconds", { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.getByRole("button", { name: "Restore as new revision", exact: true }).isVisible()).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await page.locator("#preview").boundingBox())!.height).toBeGreaterThan(150)
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
    await page.getByRole("tab", { name: "Review", exact: true }).click()
    await page.getByLabel("Review notes", { exact: true }).fill("Make the retry action clearer")
    await page.getByRole("button", { name: "Add note", exact: true }).click()
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
    await page.getByRole("tab", { name: "Review", exact: true }).click()
    const feedback = page.waitForRequest(
      (request) => request.url().endsWith("/feedback") && request.method() === "POST",
    )
    await page.getByRole("button", { name: "Send feedback", exact: true }).click()
    const body = (await feedback).postDataJSON() as Design.Feedback
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
    await page.getByRole("tab", { name: "Review", exact: true }).click()
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
