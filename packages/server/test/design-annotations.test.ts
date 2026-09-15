import { afterAll, beforeAll, expect, test } from "bun:test"
import { chromium, type Browser, type Page } from "playwright-core"
import { annotations } from "@reddb-io/redcode-design/annotations"

// Headless Playwright only: the in-frame annotation script runs in a real layout engine, never a user browser.
let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch()
}, 30000)
afterAll(async () => {
  await browser?.close()
})

interface Selection {
  target: string
  xpath: string
  context: string
  label: string
  elementText: string
}
type Seen = { type: string; rect?: unknown; findings?: Selection[] }

/** Loads markup with the annotation script at top level, where the page is its own parent. */
const open = async (body: string) => {
  const page = await browser.newPage()
  await page.setContent(
    `<!doctype html><html><body>${body}<script>(${annotations.toString()})()</script></body></html>`,
  )
  await page.evaluate(() => {
    const list: unknown[] = ((window as unknown as { seen: unknown[] }).seen = [])
    window.addEventListener("message", (event) => {
      if (["design:selection", "design:rect", "design:layout"].includes(event.data?.type)) list.push(event.data)
    })
    window.postMessage({ type: "design:annotate", enabled: true }, "*")
  })
  return page
}

const pick = async (page: Page, locator: string) => {
  await page.evaluate(() => ((window as unknown as { seen: unknown[] }).seen.length = 0))
  await page.locator(locator).click()
  await page.waitForFunction(() =>
    (window as unknown as { seen: Seen[] }).seen.some((item) => item.type === "design:selection"),
  )
  const selection = (await page.evaluate(() =>
    (window as unknown as { seen: Seen[] }).seen.find((item) => item.type === "design:selection"),
  )) as unknown as Selection
  // The selector must resolve to exactly the clicked element in its variant root, and the XPath to it too.
  const resolved = await page.locator(locator).evaluate((element, target) => {
    const prefix = /^variant:([a-zA-Z0-9_-]{1,64}) /.exec(target.target)
    const query = target.target.slice(prefix?.[0].length ?? 0)
    const scope: ParentNode = prefix ? document.querySelector(`[data-design-variant="${prefix[1]}"]`)! : document
    const found = scope.querySelectorAll(query)
    const byPath = document.evaluate(target.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    return { count: found.length, same: found[0] === element, xpath: byPath.singleNodeValue === element }
  }, selection)
  expect(resolved).toEqual({ count: 1, same: true, xpath: true })
  return selection
}

/** Asks the frame to re-address a target the way the host does; null when the frame reports it missing. */
const reveal = (page: Page, target: string) =>
  page.evaluate(async (target) => {
    const list = (window as unknown as { seen: Seen[] }).seen
    list.length = 0
    document.querySelectorAll("[data-design-reveal]").forEach((node) => node.removeAttribute("data-design-reveal"))
    window.postMessage({ type: "design:reveal", target, pulse: true }, "*")
    for (let attempt = 0; attempt < 50 && !list.some((item) => item.type === "design:rect"); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20))
    const rect = list.find((item) => item.type === "design:rect")?.rect
    return rect ? (document.querySelector("[data-design-reveal]")?.getAttribute("data-probe") ?? "found") : null
  }, target)

test("three sibling inputs get distinct selectors and labels from labels, placeholders or position", async () => {
  const page = await open(`<main>
    <form id="filters" aria-label="Filters">
      <label>Status <input name="status" data-probe="status"></label>
      <label for="owner">Owner</label><input id="owner" data-probe="owner">
      <input type="search" placeholder="Search by email" data-probe="search">
      <input autocomplete="cc-number" value="4111111111111111" data-probe="card">
    </form>
    <section><h2>Unlabelled</h2><input data-probe="a"><input data-probe="b"><input data-probe="c"></section>
  </main>`)
  try {
    await page.locator("[data-probe=b]").fill("typed value")
    expect(await pick(page, "[data-probe=status]")).toMatchObject({
      target: 'input[name="status"]',
      label: 'input[type=text] "Status"',
      context: 'main > form[id="filters"] "Filters"',
    })
    expect(await pick(page, "[data-probe=owner]")).toMatchObject({
      target: "#owner",
      label: 'input[type=text] "Owner"',
      xpath: "/html/body/main/form/input[1]",
    })
    expect(await pick(page, "[data-probe=search]")).toMatchObject({
      target: 'input[type="search"]',
      label: 'input[type=search] "Search by email"',
    })
    // Payment fields never send their value.
    expect((await pick(page, "[data-probe=card]")).elementText).toBe("")
    const middle = await pick(page, "[data-probe=b]")
    expect(middle).toMatchObject({
      label: 'input[type=text] (2 of 3 <input> in section "Unlabelled")',
      context: 'main > section "Unlabelled"',
      elementText: "typed value",
      xpath: "/html/body/main/section/input[2]",
    })
    expect(middle.target).toBe("body > main:nth-of-type(1) > section:nth-of-type(1) > input:nth-of-type(2)")
    expect(await reveal(page, middle.target)).toBe("b")
    // Targets captured before this change still resolve.
    expect(await reveal(page, "body > main:nth-child(1) > section:nth-child(2) > input:nth-child(4)")).toBe("c")
  } finally {
    await page.close()
  }
})

test("a data-design-id wins over a framework id, and a duplicated id is never used", async () => {
  const page = await open(`<div class="list">
    <button id=":r5:" data-design-id="save-lead" data-probe="save">Save</button>
    <p id="row" data-probe="first">Row</p><p id="row" data-probe="second" data-testid="second-row">Row</p>
  </div>`)
  try {
    expect(await pick(page, "[data-probe=save]")).toMatchObject({
      target: '[data-design-id="save-lead"]',
      label: 'button[data-design-id="save-lead"] "Save"',
    })
    const second = await pick(page, "[data-probe=second]")
    expect(second.target).toBe('p[data-testid="second-row"]')
    expect(second.label).toBe('p "Row" (2 of 2 <p>)')
    const first = await pick(page, "[data-probe=first]")
    expect(first.target).toBe("body > div:nth-of-type(1) > p:nth-of-type(1)")
    expect(await reveal(page, first.target)).toBe("first")
  } finally {
    await page.close()
  }
})

test("attribute values with quotes and newlines stay valid selectors, and repeated keys keep their position", async () => {
  const page = await open(`<ul data-design-id="leads">
    <li data-design-id="lead-row">Acme</li><li data-design-id="lead-row" data-probe="row">Globex</li>
  </ul>
  <input name='say "hi"&#10;there' data-probe="quoted"><input name="plain">`)
  try {
    const quoted = await pick(page, "[data-probe=quoted]")
    expect(quoted.target).toStartWith("input[name=")
    expect(await reveal(page, quoted.target)).toBe("quoted")
    expect((await pick(page, "[data-probe=row]")).target).toBe('li[data-design-id="lead-row"]:nth-of-type(2)')
  } finally {
    await page.close()
  }
})

test("table cells name their row and spanned column headers without reaching into nested tables", async () => {
  const page = await open(`<main><section data-design-id="leads">
    <table><caption>Leads</caption>
      <thead><tr><th colspan="2" data-probe="head">Name</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>Acme</td><td>Inc</td><td>Active</td></tr>
        <tr><td>Corp <table><tr><th>Nested</th></tr></table></td><th>Globex</th><td data-probe="cell">Active</td></tr>
      </tbody>
    </table>
  </section></main>`)
  try {
    const cell = await pick(page, "[data-probe=cell]")
    expect(cell.label).toStartWith('td "Active')
    expect(cell.context).toBe('main > section[data-design-id="leads"] > table "Leads" > row "Globex" > column "Status"')
    expect(cell.target).toStartWith('[data-design-id="leads"] > ')
    const head = await pick(page, "[data-probe=head]")
    expect(head.context).toBe('main > section[data-design-id="leads"] > table "Leads"')
  } finally {
    await page.close()
  }
})

test("elements inside variants are unique within their root and never re-addressed into another variant", async () => {
  const variant = (
    id: string,
    extra = "",
  ) => `<section data-design-variant="${id}" data-design-label="${id.toUpperCase()}">
    <form aria-label="Sign in"><input data-design-id="email" data-probe="${id}-email" placeholder="Email"><input data-probe="${id}-plain"><input>${extra}</form>
  </section>`
  const page = await open(
    `<header id="shared" data-probe="shared">Shared</header><main>${variant("a", '<button data-design-id="only-a">A</button>')}${variant("b")}</main>`,
  )
  try {
    await page.evaluate(() => window.postMessage({ type: "design:variant", id: "b" }, "*"))
    await page.locator("[data-probe=b-email]").waitFor({ state: "visible" })
    const email = await pick(page, "[data-probe=b-email]")
    expect(email).toMatchObject({
      target: 'variant:b [data-design-id="email"]',
      label: 'input[type=text][data-design-id="email"] "Email"',
      context: 'main > form "Sign in"',
    })
    expect(await reveal(page, email.target)).toBe("b-email")
    const plain = await pick(page, "[data-probe=b-plain]")
    expect(plain.target).toStartWith("variant:b ")
    expect(plain.label).toBe('input[type=text] (2 of 3 <input> in form "Sign in")')
    expect(await reveal(page, plain.target)).toBe("b-plain")
    // A note retargeted to a variant that lacks its element reports it missing instead of jumping variants.
    expect(await reveal(page, 'variant:b [data-design-id="only-a"]')).toBeNull()
    expect(await reveal(page, "variant:b #shared")).toBe("shared")
  } finally {
    await page.close()
  }
})

test("SVG children are addressed and the layout audit caps its findings", async () => {
  const bars = Array.from({ length: 40 }, (_, index) => `<p style="width:${3000 + index}px">Wide ${index}</p>`)
  const page = await open(`<svg id="chart" width="100" height="40"><g>
      <rect data-design-id="bar" width="10" height="40"></rect><rect data-design-id="bar" x="20" width="10" height="40" data-probe="bar"></rect>
    </g></svg>${bars.join("")}`)
  try {
    const bar = await pick(page, "[data-probe=bar]")
    expect(bar.target).toBe('rect[data-design-id="bar"]:nth-of-type(2)')
    expect(bar.xpath).toBe('/html/body/*[local-name()="svg"]/*[local-name()="g"]/*[local-name()="rect"][2]')
    await page.evaluate(() => {
      ;(window as unknown as { seen: unknown[] }).seen.length = 0
      window.postMessage({ type: "design:variant", id: "none" }, "*")
    })
    await page.waitForFunction(() =>
      (window as unknown as { seen: Seen[] }).seen.some((item) => item.type === "design:layout"),
    )
    const findings = await page.evaluate(
      () => (window as unknown as { seen: Seen[] }).seen.find((item) => item.type === "design:layout")!.findings!,
    )
    expect(findings).toHaveLength(30)
    expect(findings[0].target).toBe("body > p:nth-of-type(1)")
  } finally {
    await page.close()
  }
})
