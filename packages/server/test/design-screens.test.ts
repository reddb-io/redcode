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

/**
 * Serves a prototype with the runtime injected first, as the preview does, plus a host page framing it.
 * `before` is head markup that runs ahead of the runtime, such as a prototype global defined early.
 */
const open = async (body: string, path = "/frame", before = "") => {
  const page = await browser.newPage()
  const errors: string[] = []
  const warnings: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text())
  })
  await page.route("http://screens.local/**", (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({
      contentType: "text/html",
      body:
        url.pathname === "/host"
          ? `<!doctype html><body><script>window.received=[];addEventListener("message",(event)=>received.push(event.data))</script><iframe id="frame" src="/frame"></iframe></body>`
          : `<!doctype html><html><head>${before}<script>(${screens.toString()})()</script></head><body>${body}</body></html>`,
    })
  })
  await page.goto(`http://screens.local${path}`)
  return { page, errors, warnings }
}
/** Screens a reader can see, as "variant:id"; a screen inside a hidden screen is not visible. */
const shown = (page: Page, frame = false) =>
  (frame ? page.frames()[1] : page.mainFrame()).evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-design-screen]")]
      .filter((node) => node.checkVisibility())
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
  const { page, errors } = await open(flow)
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
  expect(errors).toEqual([])
  await page.close()
}, 30000)

test("a handler delegated from document can keep the reader on the current screen", async () => {
  // Solid and jQuery listen on document, which runs after handlers on the element itself.
  const { page } = await open(`
<section data-design-screen="form" data-design-label="Form"><input id="email"><button id="next" data-design-go="done">Next</button></section>
<section data-design-screen="done" data-design-label="Done"><p>Done</p></section>
<script>
document.addEventListener("click", (event) => {
  if (event.target.closest("#next") && !document.querySelector("#email").value) event.preventDefault()
})
</script>`)
  await page.click("#next")
  expect(await shown(page)).toEqual([":form"])
  await page.fill("#email", "ada@example.test")
  await page.click("#next")
  expect(await shown(page)).toEqual([":done"])
  await page.close()
}, 30000)

test("a submit button navigates only once the form passes validation", async () => {
  const { page } = await open(`
<section data-design-screen="form" data-design-label="Form"><form id="signup"><input id="name" required><button id="send" data-design-go="thanks">Send</button></form></section>
<section data-design-screen="thanks" data-design-label="Thanks"><p>Thanks</p></section>
<script>
document.querySelector("#signup").addEventListener("submit", (event) => {
  event.preventDefault()
  window.submitted = true
})
</script>`)
  await page.click("#send")
  expect(await shown(page)).toEqual([":form"])
  expect(await page.evaluate(() => (window as any).submitted)).toBeUndefined()
  await page.fill("#name", "Ada")
  await page.click("#send")
  expect(await shown(page)).toEqual([":thanks"])
  expect(await page.evaluate(() => (window as any).submitted)).toBe(true)
  await page.close()
}, 30000)

test("navigation records the screen in history, moves focus and Back returns", async () => {
  const { page } = await open(flow)
  await page.click("#to-pay")
  expect(await page.evaluate(() => location.hash)).toBe("#pay")
  expect(
    await page.evaluate(() => document.activeElement === document.querySelector('[data-design-screen="pay"]')),
  ).toBe(true)
  expect(
    await page.evaluate(() => document.querySelector('[data-design-screen="pay"]')!.getAttribute("tabindex")),
  ).toBe("-1")
  await page.evaluate(() => history.back())
  await page.waitForFunction(() => (window as any).design.screen() === "cart")
  expect(await shown(page)).toEqual([":cart"])
  await page.close()
}, 30000)

test("reads the initial screen from the hash, follows hash changes and tolerates malformed ones", async () => {
  const hashed = await open(flow, "/frame#pay")
  expect(await shown(hashed.page)).toEqual([":pay"])
  await hashed.page.evaluate(() => (location.hash = "#done"))
  await hashed.page.waitForFunction(() => (window as any).design.screen() === "done")
  await hashed.page.close()
  const { page, errors } = await open(flow, "/frame#50%off")
  expect(await shown(page)).toEqual([":cart"])
  await page.evaluate(() => (location.hash = "#50%off"))
  await page.evaluate(() => (location.hash = "#pay"))
  await page.waitForFunction(() => (window as any).design.screen() === "pay")
  expect(errors).toEqual([])
  await page.close()
}, 30000)

test("keeps one screen per variant, scopes clicks to their variant and falls back to page-level screens", async () => {
  const { page } = await open(`
<main data-design-variant="a" data-design-label="A"><div data-design-screen="list"><button id="a-go" data-design-go="detail">Open</button><button id="a-about" data-design-go="about">About</button></div><div data-design-screen="detail">A detail</div></main>
<main data-design-variant="b" data-design-label="B"><div data-design-screen="list">B list</div><div data-design-screen="detail">B detail</div></main>
<aside data-design-screen="help" data-design-label="Help">Help</aside><aside data-design-screen="about" data-design-label="About">About</aside>`)
  expect(await shown(page)).toEqual(["a:list", "b:list", ":help"])
  await page.click("#a-go")
  expect(await shown(page)).toEqual(["a:detail", "b:list", ":help"])
  // Without a variant the helper moves every scope that has the screen.
  await page.evaluate(() => (window as any).design.go("list"))
  expect(await shown(page)).toEqual(["a:list", "b:list", ":help"])
  await page.evaluate(() => (window as any).design.go("detail", "b"))
  expect(await shown(page)).toEqual(["a:list", "b:detail", ":help"])
  // A variant without the screen opens the page-level one, from a click or the helper.
  await page.click("#a-about")
  expect(await shown(page)).toEqual(["a:list", "b:detail", ":about"])
  expect(await page.evaluate(() => (window as any).__redcodeDesign.open("help", "b"))).toBe(true)
  expect(await shown(page)).toEqual(["a:list", "b:detail", ":help"])
  await page.close()
}, 30000)

test("a screen inside a screen is part of it, a repeated id stays hidden and a variant root is never a screen", async () => {
  const { page } = await open(`
<main id="root" data-design-variant="v" data-design-screen="root" data-design-label="V">
<section data-design-screen="one" data-design-label="One"><div data-design-screen="inner" data-design-label="Inner">Inner</div></section>
<section data-design-screen="two" data-design-label="Two">Two</section>
<section id="repeat" data-design-screen="one" data-design-label="Again">Again</section>
</main>`)
  expect(await shown(page)).toEqual(["v:root", "v:one", "v:inner"])
  expect(await page.evaluate(() => (window as any).design.screens())).toEqual([
    { id: "one", name: "One", variant: "v" },
    { id: "two", name: "Two", variant: "v" },
  ])
  await page.evaluate(() => (window as any).design.go("two", "v"))
  expect(await shown(page)).toEqual(["v:root", "v:two"])
  await page.evaluate(() => (window as any).design.go("one", "v"))
  expect(await page.evaluate(() => document.querySelector<HTMLElement>("#repeat")!.checkVisibility())).toBe(false)
  await page.close()
}, 30000)

test("a prototype's own design global wins and the private handle keeps working", async () => {
  const late = await open(`${flow}<script>var design = { tokens: { accent: "red" } }</script>`)
  expect(await late.page.evaluate(() => (window as any).design.tokens.accent)).toBe("red")
  expect(await late.page.evaluate(() => (window as any).__redcodeDesign.go("pay"))).toBe(true)
  expect(await shown(late.page)).toEqual([":pay"])
  await late.page.close()
  const early = await open(flow, "/frame", `<script>window.design = { brand: true }</script>`)
  expect(await early.page.evaluate(() => (window as any).design.brand)).toBe(true)
  expect(early.warnings.some((text) => text.includes("window.__redcodeDesign"))).toBe(true)
  expect(await early.page.evaluate(() => (window as any).__redcodeDesign.screens().length)).toBe(3)
  await early.page.close()
}, 30000)

test("announces screens to the host, follows host selection and picks up screens mounted later", async () => {
  const { page } = await open(flow, "/host")
  const frame = () => page.frames()[1]
  const announced = () =>
    page.evaluate(() => (window as any).received.filter((item: any) => item.type === "design:screens"))
  await page.waitForFunction(() => (window as any).received.some((item: any) => item.type === "design:screens"))
  expect((await announced()).at(-1)).toEqual({
    type: "design:screens",
    screens: [
      { id: "cart", name: "Cart", variant: "" },
      { id: "pay", name: "Payment", variant: "" },
      { id: "done", name: "Done", variant: "" },
    ],
    current: { "": "cart" },
  })
  const post = (id: string) =>
    page.evaluate(
      (id) =>
        document
          .querySelector<HTMLIFrameElement>("#frame")!
          .contentWindow!.postMessage({ type: "design:screen", id }, "*"),
      id,
    )
  await post("done")
  await page.waitForFunction(() =>
    (window as any).received.some((item: any) => item.type === "design:screens" && item.current[""] === "done"),
  )
  expect(await shown(page, true)).toEqual([":done"])
  // A message from anything but the parent is ignored: it is queued before the host's next message,
  // so had it been accepted, "cart" would be announced before "pay".
  const before = (await announced()).length
  await frame().evaluate(() => window.postMessage({ type: "design:screen", id: "cart" }, "*"))
  await post("pay")
  await page.waitForFunction(() =>
    (window as any).received.some((item: any) => item.type === "design:screens" && item.current[""] === "pay"),
  )
  expect((await announced()).slice(before).map((item: any) => item.current[""])).toEqual(["pay"])
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
  expect(await shown(page, true)).toEqual([":pay"])
  await page.close()
}, 30000)

test("replays params to late listeners, merges reported state and leaves pages without screens alone", async () => {
  const { page } = await open(`<main id="plain" style="display:grid"><p>No screens here</p></main>`)
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
