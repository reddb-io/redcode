import { afterAll, beforeAll, expect, test } from "bun:test"
import { chromium, type Browser, type Page } from "playwright-core"
import { screens } from "@reddb-io/redcode-design/screens"

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch()
}, 30000)
afterAll(async () => {
  await browser?.close()
}, 30000)

/** Serves a prototype with the runtime injected first, as the preview does, plus a host page framing it. */
const open = async (body: string, path = "/frame") => {
  const page = await browser.newPage()
  await page.route("http://screens.local/**", (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({
      contentType: "text/html",
      body:
        url.pathname === "/host"
          ? `<!doctype html><body><script>window.received=[];addEventListener("message",(event)=>received.push(event.data))</script><iframe id="frame" src="/frame"></iframe></body>`
          : `<!doctype html><html><head><script>(${screens.toString()})()</script></head><body>${body}</body></html>`,
    })
  })
  await page.goto(`http://screens.local${path}`)
  return page
}
const shown = (page: Page, frame = false) =>
  (frame ? page.frames()[1] : page.mainFrame()).evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-design-screen]")]
      .filter((node) => getComputedStyle(node).display !== "none")
      .map(
        (node) =>
          `${node.closest<HTMLElement>("[data-design-variant]")?.dataset.designVariant ?? ""}:${node.dataset.designScreen}`,
      ),
  )

const flow = `
<section data-design-screen="cart" data-design-label="Cart" style="display:flex"><button id="to-pay" data-design-go="pay">Pay</button><a id="link-done" href="#done">Skip</a></section>
<section data-design-screen="pay" data-design-label="Payment"><input id="card"><button id="submit" data-design-go="done">Confirm</button></section>
<section data-design-screen="done" data-design-label="Done"><p>Thanks</p></section>
<script>
window.events = []
addEventListener("design:screen", (event) => events.push(event.detail))
document.querySelector("#submit").addEventListener("click", (event) => {
  if (!document.querySelector("#card").value) event.preventDefault()
})
</script>`

test("shows one screen at a time and navigates by attribute, link, helper and event", async () => {
  const page = await open(flow)
  expect(await shown(page)).toEqual([":cart"])
  await page.click("#to-pay")
  expect(await shown(page)).toEqual([":pay"])
  // A handler that prevents the default keeps the reader on the current screen.
  await page.click("#submit")
  expect(await shown(page)).toEqual([":pay"])
  await page.fill("#card", "4242")
  await page.click("#submit")
  expect(await shown(page)).toEqual([":done"])
  expect(await page.evaluate(() => (window as any).design.go("cart"))).toBe(true)
  expect(await shown(page)).toEqual([":cart"])
  await page.click("#link-done")
  expect(await shown(page)).toEqual([":done"])
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("design:go", { detail: { screen: "pay" } })))
  expect(await shown(page)).toEqual([":pay"])
  expect(await page.evaluate(() => (window as any).design.go("missing"))).toBe(false)
  expect(await page.evaluate(() => (window as any).design.screen())).toBe("pay")
  expect(await page.evaluate(() => (window as any).events)).toEqual([
    { screen: "pay", previous: "cart", variant: "" },
    { screen: "done", previous: "pay", variant: "" },
    { screen: "cart", previous: "done", variant: "" },
    { screen: "done", previous: "cart", variant: "" },
    { screen: "pay", previous: "done", variant: "" },
  ])
  await page.close()
}, 30000)

test("reads the initial screen from the hash and follows hash changes", async () => {
  const page = await open(flow, "/frame#pay")
  expect(await shown(page)).toEqual([":pay"])
  await page.evaluate(() => (location.hash = "#done"))
  await page.waitForFunction(() => (window as any).design.screen() === "done")
  expect(await shown(page)).toEqual([":done"])
  await page.close()
}, 30000)

test("keeps one current screen per variant and scopes navigation to the clicked variant", async () => {
  const page = await open(`
<main data-design-variant="a" data-design-label="A"><div data-design-screen="list"><button id="a-go" data-design-go="detail">Open</button></div><div data-design-screen="detail">A detail</div></main>
<main data-design-variant="b" data-design-label="B"><div data-design-screen="list">B list</div><div data-design-screen="detail">B detail</div></main>`)
  expect(await shown(page)).toEqual(["a:list", "b:list"])
  await page.click("#a-go")
  expect(await shown(page)).toEqual(["a:detail", "b:list"])
  // Without a variant the helper moves every scope that has the screen.
  await page.evaluate(() => (window as any).design.go("list"))
  expect(await shown(page)).toEqual(["a:list", "b:list"])
  await page.evaluate(() => (window as any).design.go("detail", "b"))
  expect(await shown(page)).toEqual(["a:list", "b:detail"])
  await page.close()
}, 30000)

test("announces screens to the host, follows host selection and picks up screens mounted later", async () => {
  const page = await open(flow, "/host")
  const frame = () => page.frames()[1]
  await page.waitForFunction(() => (window as any).received.some((item: any) => item.type === "design:screens"))
  const last = () =>
    page.evaluate(() => (window as any).received.filter((item: any) => item.type === "design:screens").at(-1))
  expect(await last()).toEqual({
    type: "design:screens",
    screens: [
      { id: "cart", name: "Cart", variant: "" },
      { id: "pay", name: "Payment", variant: "" },
      { id: "done", name: "Done", variant: "" },
    ],
    current: { "": "cart" },
  })
  await page.evaluate(() =>
    document
      .querySelector<HTMLIFrameElement>("#frame")!
      .contentWindow!.postMessage({ type: "design:screen", id: "done" }, "*"),
  )
  await page.waitForFunction(() =>
    (window as any).received.some((item: any) => item.type === "design:screens" && item.current[""] === "done"),
  )
  expect(await shown(page, true)).toEqual([":done"])
  // A message from anything but the parent is ignored.
  await frame().evaluate(() => window.postMessage({ type: "design:screen", id: "cart" }, "*"))
  await Bun.sleep(50)
  expect(await shown(page, true)).toEqual([":done"])
  await frame().evaluate(() => {
    const extra = document.createElement("section")
    extra.dataset.designScreen = "receipt"
    extra.dataset.designLabel = "Receipt"
    document.body.append(extra)
  })
  await page.waitForFunction(() =>
    (window as any).received.some(
      (item: any) => item.type === "design:screens" && item.screens.some((screen: any) => screen.id === "receipt"),
    ),
  )
  expect(await shown(page, true)).toEqual([":done"])
  await page.close()
}, 30000)

test("replays params to late listeners, merges reported state and leaves pages without screens alone", async () => {
  const page = await open(`<main id="plain" style="display:grid"><p>No screens here</p></main>`)
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("#plain")!).display)).toBe("grid")
  const calls = await page.evaluate(() => {
    const design = (window as any).design
    const calls: unknown[] = []
    window.dispatchEvent(
      new CustomEvent("design:params", { detail: { values: { checkout: { items: 2, outcome: "success" } } } }),
    )
    // Subscribing after the values arrived still receives them, as an asynchronously mounted component would.
    const stop = design.params.on("checkout", (fields: unknown, meta: unknown) => calls.push([fields, meta]))
    design.state("checkout", { outcome: "error" })
    calls.push(design.params.get("checkout"))
    window.dispatchEvent(
      new CustomEvent("design:params", { detail: { values: { checkout: { items: 0 } }, reset: true } }),
    )
    stop()
    window.dispatchEvent(new CustomEvent("design:params", { detail: { values: { checkout: { items: 5 } } } }))
    calls.push(design.screens(), design.screen())
    return calls
  })
  expect(calls).toEqual([
    [{ items: 2, outcome: "success" }, { reset: false }],
    { items: 2, outcome: "error" },
    [{ items: 0 }, { reset: true }],
    [],
    "",
  ])
  await page.close()
}, 30000)
