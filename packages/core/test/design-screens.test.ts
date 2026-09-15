import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseHTML } from "linkedom"
import { DesignQuality } from "../src/design/quality"
import { DesignPlaybooks } from "../src/design/playbooks"
import { DESIGN_INSTRUCTIONS } from "../src/design/instructions"
import { injectScreens } from "../src/design/renderer"

const temporary = await mkdtemp(path.join(os.tmpdir(), "design-screens-"))
afterAll(() => rm(temporary, { recursive: true, force: true }))

const problems = (body: string) =>
  DesignQuality.screenProblems(
    parseHTML(`<!doctype html><html><body>${body}</body></html>`).document as unknown as ParentNode,
  )

describe("DesignQuality.screenProblems", () => {
  test("accepts the same screen ids in different variants and targets in their own scope", () => {
    expect(
      problems(
        `<main data-design-variant="a"><div data-design-screen="list" data-design-label="List"><button data-design-go="detail">Open</button></div><div data-design-screen="detail" data-design-label="Detail"></div></main><main data-design-variant="b"><div data-design-screen="list" data-design-label="List"></div><div data-design-screen="detail" data-design-label="Detail"><button data-design-go="list">Back</button></div></main>`,
      ),
    ).toEqual([])
    // Page-level screens are reachable from inside a variant.
    expect(
      problems(
        `<div data-design-screen="help" data-design-label="Help"></div><main data-design-variant="a"><button data-design-go="help">Help</button></main>`,
      ),
    ).toEqual([])
  })

  test("describes what the runtime does with nested, repeated, invalid and misplaced screens", () => {
    expect(
      problems(
        `<main data-design-variant="a"><div data-design-screen="list" data-design-label="List"><button data-design-go="detail">Open</button><div data-design-screen="inner" data-design-label="Inner"></div></div><div data-design-screen="list" data-design-label="Again"></div><div data-design-screen="bad id"></div><div data-design-screen="nolabel"></div></main><main data-design-variant="b" data-design-screen="root" data-design-label="Root"></main>`,
      ),
    ).toEqual([
      'Screen "inner" is inside screen "list", so it is part of that screen rather than a screen of its own. Keep screens one level deep and use params for states inside a screen.',
      'Screen id "list" is repeated in variant "a"; only the first one is shown and the repeat stays hidden.',
      'Screen id "bad id" in variant "a" is invalid: use 1-64 letters, digits, underscores or hyphens. It stays hidden.',
      'Screen "nolabel" in variant "a" has no data-design-label; the review shows its id.',
      'data-design-screen="root" is on a variant root and is ignored; put screens inside the variant root.',
      'data-design-go="detail" in variant "a" names no screen there; the click does nothing.',
    ])
  })
})

describe("DesignQuality.screenWarnings", () => {
  test("parses an HTML entry and scans component sources for literal targets", async () => {
    const html = path.join(temporary, "html")
    await Bun.write(
      path.join(html, "index.html"),
      `<!doctype html><body><section data-design-screen="cart" data-design-label="Cart"><button data-design-go="pay">Pay</button></section></body>`,
    )
    expect(await DesignQuality.screenNotice(html, "html", "index.html")).toBe(
      '\nScreen warnings:\n- data-design-go="pay" in the page names no screen there; the click does nothing.',
    )
    const react = path.join(temporary, "react")
    await Bun.write(
      path.join(react, "src/main.tsx"),
      `export const App = () => <><section data-design-screen="cart" data-design-label="Cart"><button data-design-go={"pay"}>Pay</button></section><section data-design-screen='pay'><button data-design-go="receipt">Done</button></section></>`,
    )
    await Bun.write(path.join(react, "node_modules/lib/index.js"), `x = '<a data-design-go="ignored">'`)
    expect(await DesignQuality.screenWarnings(react, "react", "src/main.tsx")).toEqual([
      'data-design-go="receipt" names no data-design-screen in the sources; the click does nothing.',
    ])
    expect(await DesignQuality.mentionsScreens(react)).toBe(true)
    expect(await DesignQuality.screenNotice(path.join(temporary, "missing"), "html", "index.html")).toBe("")
  })

  test("skips target checks when a screen id is computed and sources without screens entirely", async () => {
    const computed = path.join(temporary, "computed")
    await Bun.write(
      path.join(computed, "src/main.tsx"),
      `export const Step = (props: { id: string }) => <section data-design-screen={props.id}><button data-design-go="review">Next</button></section>`,
    )
    expect(await DesignQuality.screenWarnings(computed, "react", "src/main.tsx")).toEqual([])
    const plain = path.join(temporary, "plain")
    await Bun.write(
      path.join(plain, "src/main.tsx"),
      `export const App = () => <button data-design-go="nowhere">Go</button>`,
    )
    expect(await DesignQuality.screenWarnings(plain, "react", "src/main.tsx")).toEqual([])
    expect(await DesignQuality.mentionsScreens(plain)).toBe(false)
  })
})

describe("injectScreens", () => {
  test("places the runtime inside head, never before the doctype or inside a header", () => {
    const withHead = injectScreens(
      '<!doctype html><html lang="en"><head><title>x</title></head><body><header>Top</header></body></html>',
    )
    expect(withHead).toStartWith('<!doctype html><html lang="en"><head><script>(')
    expect(withHead).toContain("<body><header>Top</header>")
    expect(injectScreens("<!doctype html><header>Top</header>")).toStartWith("<!doctype html><script>(")
    expect(injectScreens("<!doctype html><header>Top</header>")).toEndWith("</script><header>Top</header>")
    expect(injectScreens("<html><body><header>Top</header></body></html>")).toStartWith("<html><script>(")
    expect(injectScreens("<p>Bare</p>")).toStartWith("<script>(")
  })
})

describe("screen guidance", () => {
  test("the prompt separates variants, screens, scenarios and params and documents the helper", () => {
    for (const phrase of [
      "Variants are alternative directions",
      "Screens are the pages or steps of one flow",
      "Scenarios are states an audit verifies",
      "Params are live knobs",
      'data-design-go="screen-id"',
      "design.params.on(",
      'design.state("checkout", { items })',
      "scenario.screen",
      "including delegated ones",
      "window.__redcodeDesign",
    ])
      expect(DESIGN_INSTRUCTIONS).toContain(phrase)
    const flow = DesignPlaybooks.render(DesignPlaybooks.find("flow")!)
    expect(flow).toContain("data-design-screen")
    expect(flow).toContain("multi-page app")
  })
})
