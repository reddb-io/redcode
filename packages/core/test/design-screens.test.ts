import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseHTML } from "linkedom"
import { DesignQuality } from "../src/design/quality"
import { DesignPlaybooks } from "../src/design/playbooks"
import { DESIGN_INSTRUCTIONS } from "../src/design/instructions"

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

  test("names duplicate, invalid, nested and unlabelled screens and dead navigation targets", () => {
    const found = problems(
      `<main data-design-variant="a"><div data-design-screen="list" data-design-label="List"><button data-design-go="detail">Open</button><div data-design-screen="inner" data-design-label="Inner"></div></div><div data-design-screen="list" data-design-label="Again"></div><div data-design-screen="bad id"></div><div data-design-screen="nolabel"></div></main><main data-design-variant="b" data-design-screen="root" data-design-label="Root"></main>`,
    )
    expect(found).toEqual([
      'Screen "inner" is nested inside screen "list"; nested screens are ignored. Keep screens one level deep and use params for states inside a screen.',
      'Screen id "list" is repeated in variant "a"; only the first one is used.',
      'Screen id "bad id" in variant "a" is invalid: use 1-64 letters, digits, underscores or hyphens. It is never shown.',
      'Screen "nolabel" in variant "a" has no data-design-label; the review shows its id.',
      'Screen "root" is on a variant root; put screens inside the variant root instead.',
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
    expect(await DesignQuality.screenNotice(path.join(temporary, "missing"), "html", "index.html")).toBe("")
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
      "design.state(",
      "scenario.screen",
    ])
      expect(DESIGN_INSTRUCTIONS).toContain(phrase)
    const flow = DesignPlaybooks.render(DesignPlaybooks.find("flow")!)
    expect(flow).toContain("data-design-screen")
    expect(flow).toContain("multi-page app")
  })
})
