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
  parent: string
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
      label: 'input[type=text] "Status" in label "Status" in form[id="filters"] "Filters" in main',
      context: 'main > form[id="filters"] "Filters" > label "Status"',
      parent: 'label "Status" (/html/body/main/form/label[1]) in form[id="filters"] "Filters" (/html/body/main/form)',
    })
    expect(await pick(page, "[data-probe=owner]")).toMatchObject({
      target: "#owner",
      label: 'input[type=text] "Owner" in form[id="filters"] "Filters" in main',
      xpath: "/html/body/main/form/input[1]",
      parent: 'form[id="filters"] "Filters" (/html/body/main/form) in main (/html/body/main)',
    })
    expect(await pick(page, "[data-probe=search]")).toMatchObject({
      target: 'input[type="search"]',
      label: 'input[type=search] "Search by email" in form[id="filters"] "Filters" in main',
    })
    // Payment fields never send their value.
    expect((await pick(page, "[data-probe=card]")).elementText).toBe("")
    const middle = await pick(page, "[data-probe=b]")
    // Three identical breadcrumbs get their position among the elements that share it.
    expect(middle).toMatchObject({
      label: 'input[type=text] in section "Unlabelled" in main (2 of 3)',
      context: 'main > section "Unlabelled"',
      parent: 'section "Unlabelled" (/html/body/main/section) in main (/html/body/main)',
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
    // Outside every named ancestor the parent still names the place; a label is never a bare tag.
    expect(await pick(page, "[data-probe=save]")).toMatchObject({
      target: '[data-design-id="save-lead"]',
      label: 'button[data-design-id="save-lead"] "Save" in div',
      parent: "div (/html/body/div) in body (/html/body)",
    })
    const second = await pick(page, "[data-probe=second]")
    expect(second.target).toBe('p[data-testid="second-row"]')
    expect(second.label).toBe('p "Row" in div (2 of 2)')
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
    expect(cell.label).toBe('td "Active" in row "Globex" in table "Leads" in section[data-design-id="leads"]')
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
      label: 'input[type=text][data-design-id="email"] "Email" in form "Sign in" in main',
      context: 'main > form "Sign in"',
    })
    expect(await reveal(page, email.target)).toBe("b-email")
    const plain = await pick(page, "[data-probe=b-plain]")
    expect(plain.target).toStartWith("variant:b ")
    // Only the visible variant's inputs with the same breadcrumb compete for the position.
    expect(plain.label).toBe('input[type=text] in form "Sign in" in main (1 of 2)')
    expect(await reveal(page, plain.target)).toBe("b-plain")
    // A note retargeted to a variant that lacks its element reports it missing instead of jumping variants.
    expect(await reveal(page, 'variant:b [data-design-id="only-a"]')).toBeNull()
    expect(await reveal(page, "variant:b #shared")).toBe("shared")
  } finally {
    await page.close()
  }
})

test("a label is a breadcrumb through the named ancestors, so icons and repeated names stay apart", async () => {
  const icon = '<svg width="12" height="12" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>'
  const page =
    await open(`<svg width="12" height="12" viewBox="0 0 10 10" data-probe="lone"><path d="M0 0L10 10"/></svg>
    <header>
      <nav><a href="#">Home</a></nav>
      <button data-design-id="user-menu"><span>Filipe</span>${icon.replace("<svg", '<svg data-probe="chevron"')}</button>
    </header>
    <aside>
      <h2>Conversations</h2>
      <form><input type="text" placeholder="Quick search" data-probe="search"></form>
      <button data-probe="new-chat">+ New conversation</button>
      <ul><li><span>Filipe</span></li><li><span data-probe="row-name">Filipe</span></li></ul>
    </aside>
    <main><h1>Hello, <span data-probe="main-name">Filipe</span></h1></main>
    <div role="dialog" aria-label="New conversation"><button aria-label="Close">${icon.replace("<svg", '<svg data-probe="close-icon"')}</button><p>Body</p></div>`)
  try {
    const search = await pick(page, "[data-probe=search]")
    expect(search).toMatchObject({
      label: 'input[type=text] "Quick search" in form in aside "Conversations"',
      context: 'aside "Conversations" > form',
      parent: 'form (/html/body/aside/form) in aside "Conversations" (/html/body/aside)',
    })
    expect((await pick(page, "[data-probe=new-chat]")).label).toBe(
      'button "+ New conversation" in aside "Conversations"',
    )
    // An icon names the control holding it, and a stable id on that control leads.
    const chevron = await pick(page, "[data-probe=chevron]")
    expect(chevron).toMatchObject({
      label: 'svg in button[data-design-id="user-menu"] "Filipe" in header',
      target: '[data-design-id="user-menu"] > svg:nth-of-type(1)',
      parent: 'button[data-design-id="user-menu"] "Filipe" (/html/body/header/button) in header (/html/body/header)',
    })
    expect(await pick(page, "[data-probe=close-icon]")).toMatchObject({
      label: 'svg in button "Close" in div[role=dialog] "New conversation"',
      context: 'div[role=dialog] "New conversation" > button "Close"',
      parent: 'button "Close" (/html/body/div/button) in div[role=dialog] "New conversation" (/html/body/div)',
    })
    // The same name in the sidebar list and the main heading reads differently, and identical rows are numbered.
    const row = await pick(page, "[data-probe=row-name]")
    expect(row.label).toBe('span "Filipe" in li "Filipe" in aside "Conversations" (2 of 2)')
    const main = await pick(page, "[data-probe=main-name]")
    expect(main.label).toBe('span "Filipe" in h1 "Hello, Filipe" in main "Hello, Filipe"')
    expect(await pick(page, "[data-probe=lone]")).toMatchObject({ label: "svg in body", parent: "body (/html/body)" })
    const labels = [search.label, chevron.label, row.label, main.label]
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.every((label) => label.includes(" in "))).toBe(true)
  } finally {
    await page.close()
  }
})

test("the peer scan stops at its limit, skips generated ids in the label and keeps the position when cut", async () => {
  const rows = Array.from(
    { length: 300 },
    (_, index) =>
      `<li data-design-id="row-${"x".repeat(36)}" role="listitem"><button data-probe="s${index}">Filipe</button> ${"wrote a long line of text".repeat(2)}</li>`,
  )
  const page =
    await open(`<div role="presentation"><section data-design-id="feed-${"y".repeat(35)}" aria-label="${"Conversations of the week".repeat(2)}">
    <ul id=":r3:" aria-label="${"All the rows in the feed".repeat(2)}">${rows.join("")}</ul>
  </section></div>`)
  try {
    const first = await pick(page, "[data-probe=s0]")
    // Fifty peers were examined and all matched, then the scan stopped: the count is a lower bound.
    expect(first.label).toEndWith(" (1 of 51+)")
    // The breadcrumb, not the position, is what a long label loses.
    expect([...first.label]).toHaveLength(240)
    expect(first.label).toContain("…")
    expect(first.label).toStartWith('button "Filipe" in li[role=listitem][data-design-id="row-')
    // A framework id names the list in the context, never in the label; a presentation role is no landmark.
    expect(first.label).toContain(' in ul "All the rows')
    expect(first.label).not.toContain(":r3:")
    expect(first.context).toContain('ul[id=":r3:"] "All the rows')
    expect(first.context).toStartWith('section[data-design-id="feed-')
    expect(first.parent).toStartWith('li[role=listitem][data-design-id="row-')
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
