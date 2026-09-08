import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { chromium, type Browser } from "playwright-core"
import { parseGIF, decompressFrames } from "gifuct-js"
import type { Design } from "@reddb-io/redcode-schema/design"
import { webHandler } from "../src/routes"
import { designDependencies } from "../../core/test/fixture/design-dependencies"

const directory = await mkdtemp(path.join(os.tmpdir(), "design-browser-"))
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
      : 'import { render } from "solid-js/web"; import { createSignal } from "solid-js"; const App=()=>{const [added,setAdded]=createSignal(false);return <main><h1>Checkout</h1><button onClick={()=>setAdded(true)}>{added()?"Added":"Add item"}</button></main>};render(()=><App />,document.getElementById("root")!)',
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
  await rm(directory, { recursive: true, force: true })
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
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: "Approve this revision" }).click()
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
  await page.getByRole("button", { name: "Restore as new revision" }).click()
  await page.getByRole("option", { name: /Restored: First direction/ }).waitFor({ state: "attached" })
  const revisions = await api<Design.Revision[]>(`${current.root}/${current.document.id}/revision`)
  expect(revisions).toHaveLength(2)
  expect(revisions[0].parent).toBe(current.revision.id)
  await page.close()
}, 90000)

test("SVG asset: browser import, local GIF progress and downloadable animation", async () => {
  const current = await published("html")
  const page = await browser.newPage({ acceptDownloads: true })
  await page.goto(`${base}${current.root}/review`)
  await page.getByLabel("Attach image or SVG").setInputFiles({
    name: "motion.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><circle r="4" cy="10" fill="red"><animate attributeName="cx" values="4;36;4" dur="1s" repeatCount="indefinite"/></circle></svg>',
    ),
  })
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
      throw new Error("No protected dependency permission request")
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
