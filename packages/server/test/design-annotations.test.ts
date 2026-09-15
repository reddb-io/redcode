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

/** Loads markup with the annotation script at top level, where the page is its own parent. */
const open = async (body: string) => {
  const page = await browser.newPage()
  await page.setContent(
    `<!doctype html><html><body>${body}<script>(${annotations.toString()})()</script></body></html>`,
  )
  await page.evaluate(() => {
    const seen: unknown[] = ((window as unknown as { seen: unknown[] }).seen = [])
    window.addEventListener("message", (event) => {
      if (event.data?.type === "design:selection" || event.data?.type === "design:rect") seen.push(event.data)
    })
    window.postMessage({ type: "design:annotate", enabled: true }, "*")
  })
  return page
}

const pick = async (page: Page, locator: string) => {
  await page.evaluate(() => ((window as unknown as { seen: unknown[] }).seen.length = 0))
  await page.locator(locator).click()
  await page.waitForFunction(() =>
    (window as unknown as { seen: { type: string }[] }).seen.some((item) => item.type === "design:selection"),
  )
  const selection = (await page.evaluate(() =>
    (window as unknown as { seen: { type: string }[] }).seen.find((item) => item.type === "design:selection"),
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

/** Asks the frame to re-address a target the way the host does and reports whether it found it. */
const reveal = (page: Page, target: string) =>
  page.evaluate(async (target) => {
    const seen = (window as unknown as { seen: { type: string; rect: unknown }[] }).seen
    seen.length = 0
    window.postMessage({ type: "design:reveal", target, pulse: true }, "*")
    for (let attempt = 0; attempt < 50 && !seen.some((item) => item.type === "design:rect"); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20))
    const rect = seen.find((item) => item.type === "design:rect")?.rect
    return rect ? (document.querySelector("[data-design-reveal]")?.getAttribute("data-probe") ?? "found") : null
  }, target)

test("three sibling inputs get distinct selectors and labels from labels, placeholders or position", async () => {
  const page = await open(`<main>
    <form id="filters" aria-label="Filters">
      <label>Status <input name="status" data-probe="status"></label>
      <label for="owner">Owner</label><input id="owner" data-probe="owner">
      <input type="email" placeholder="Search by email" data-probe="search">
    </form>
    <section><h2>Unlabelled</h2><input data-probe="a"><input data-probe="b"><input data-probe="c"></section>
  </main>`)
  try {
    await page.locator("[data-probe=b]").fill("typed value")
    expect(await pick(page, "[data-probe=status]")).toMatchObject({
      target: 'input[name="status"]',
      label: 'input[type=text] "Status"',
      context: 'main > form#filters "Filters"',
    })
    expect(await pick(page, "[data-probe=owner]")).toMatchObject({
      target: "#owner",
      label: 'input[type=text] "Owner"',
      xpath: "/html/body/main/form/input[1]",
    })
    expect(await pick(page, "[data-probe=search]")).toMatchObject({
      target: 'input[placeholder="Search by email"]',
      label: 'input[type=email] "Search by email"',
    })
    const middle = await pick(page, "[data-probe=b]")
    expect(middle).toMatchObject({
      label: 'input[type=text] (2 of 3 inputs in section "Unlabelled")',
      context: 'main > section "Unlabelled"',
      elementText: "typed value",
      xpath: "/html/body/main/section/input[2]",
    })
    expect(middle.target).toBe("body > main:nth-child(1) > section:nth-child(2) > input:nth-child(3)")
    expect(await reveal(page, middle.target)).toBe("b")
    // Targets captured before this change still resolve.
    expect(await reveal(page, "#owner")).toBe("owner")
  } finally {
    await page.close()
  }
})

test("a duplicated id is not used as the selector", async () => {
  const page = await open(`<div class="list">
    <p id="row" data-probe="first">Row</p><p id="row" data-probe="second" data-testid="second-row">Row</p>
  </div>`)
  try {
    const second = await pick(page, "[data-probe=second]")
    expect(second.target).toBe('p[data-testid="second-row"]')
    expect(second.label).toBe('p "Row" (2 of 2 ps)')
    const first = await pick(page, "[data-probe=first]")
    expect(first.target).not.toContain("#row")
    expect(await reveal(page, first.target)).toBe("first")
  } finally {
    await page.close()
  }
})

test("table cells name their row and column headers", async () => {
  const page = await open(`<main><section data-design-id="leads">
    <table><caption>Leads</caption>
      <thead><tr><th>Name</th><th>Status</th></tr></thead>
      <tbody><tr><td>Acme</td><td>Active</td></tr><tr><td>Globex</td><td data-probe="cell">Active</td></tr></tbody>
    </table>
  </section></main>`)
  try {
    const cell = await pick(page, "[data-probe=cell]")
    expect(cell.label).toBe('td "Active" (4 of 4 tds in table "Leads")')
    expect(cell.context).toBe('main > section[data-design-id=leads] > table "Leads" > row "Globex" > column "Status"')
    expect(cell.target).toStartWith('[data-design-id="leads"] > ')
  } finally {
    await page.close()
  }
})

test("elements inside variants are unique within their root and re-addressed there", async () => {
  const variant = (id: string) => `<section data-design-variant="${id}" data-design-label="${id.toUpperCase()}">
    <form aria-label="Sign in"><input data-design-id="email" data-probe="${id}-email" placeholder="Email"><input data-probe="${id}-plain"><input></form>
  </section>`
  const page = await open(`<main>${variant("a")}${variant("b")}</main>`)
  try {
    await page.evaluate(() => window.postMessage({ type: "design:variant", id: "b" }, "*"))
    await page.locator("[data-probe=b-email]").waitFor({ state: "visible" })
    const email = await pick(page, "[data-probe=b-email]")
    expect(email).toMatchObject({
      target: 'variant:b [data-design-id="email"]',
      label: 'input[type=text] "Email"',
      context: 'main > form "Sign in"',
    })
    expect(await reveal(page, email.target)).toBe("b-email")
    const plain = await pick(page, "[data-probe=b-plain]")
    expect(plain.target).toStartWith("variant:b ")
    expect(plain.label).toBe('input[type=text] (2 of 3 inputs in form "Sign in")')
    expect(await reveal(page, plain.target)).toBe("b-plain")
  } finally {
    await page.close()
  }
})
