import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { chromium, type Browser } from "playwright-core"
import { Design } from "@reddb-io/redcode-schema/design"
import { deck, slides } from "@reddb-io/redcode-design/slides"
import { screens } from "@reddb-io/redcode-design/screens"
import { DesignPlaybooks } from "../src/design/playbooks"
import { DesignQuality } from "../src/design/quality"
import { injectScreens } from "../src/design/renderer-local"

const logic = deck()

describe("slide navigation", () => {
  test.each([
    ["ArrowRight", false, 0, 1],
    ["ArrowDown", false, 1, 2],
    ["PageDown", false, 0, 1],
    [" ", false, 0, 1],
    [" ", true, 2, 1],
    ["ArrowLeft", false, 2, 1],
    ["ArrowUp", false, 1, 0],
    ["PageUp", false, 1, 0],
    ["Home", false, 2, 0],
    ["End", false, 0, 2],
  ] as const)("%s (shift %p) moves from slide %i to slide %i of three", (key, shift, from, to) => {
    expect(logic.step({ key, shift }, from, 3)).toBe(to)
  })

  test("stops at either end, starts from the first slide when none is current and ignores other keys", () => {
    expect(logic.step({ key: "ArrowRight" }, 2, 3)).toBe(2)
    expect(logic.step({ key: "ArrowLeft" }, 0, 3)).toBe(0)
    expect(logic.step({ key: "ArrowRight" }, -1, 3)).toBe(1)
    expect(logic.step({ key: "a" }, 0, 3)).toBeUndefined()
    expect(logic.step({ key: "Enter" }, 0, 3)).toBeUndefined()
    expect(logic.step({ key: "ArrowRight" }, 0, 0)).toBeUndefined()
  })
})

describe("presenter sync", () => {
  const show = { slide: "slide-1", started: 1000 }

  test("a goto moves every window to its slide and keeps the talk's start", () => {
    expect(logic.sync(show, { type: "goto", slide: "slide-2" })).toEqual({
      show: { slide: "slide-2", started: 1000 },
      changed: true,
    })
    expect(logic.sync(show, { type: "goto", slide: "slide-1" }).changed).toBe(false)
  })

  test("a hello is answered with the window's state once it knows its slide", () => {
    expect(logic.sync(show, { type: "hello" })).toEqual({
      show,
      changed: false,
      reply: { type: "state", slide: "slide-1", started: 1000 },
    })
    expect(logic.sync({ slide: "", started: 0 }, { type: "hello" }).reply).toBeUndefined()
  })

  test("a state answer moves a new window and gives it the talk's start only when it has none", () => {
    expect(logic.sync({ slide: "", started: 0 }, { type: "state", slide: "slide-3", started: 500 }).show).toEqual({
      slide: "slide-3",
      started: 500,
    })
    // The presenter keeps its own timer when the audience window answers without one.
    expect(logic.sync(show, { type: "state", slide: "slide-2", started: 0 }).show).toEqual({
      slide: "slide-2",
      started: 1000,
    })
    expect(logic.sync(show, { type: "state", slide: "slide-1", started: 400 }).show.started).toBe(1000)
  })

  test("a reset restarts the timer everywhere", () => {
    expect(logic.sync(show, { type: "reset", started: 9000 })).toEqual({
      show: { slide: "slide-1", started: 9000 },
      changed: true,
    })
  })

  test("malformed messages leave the show as it is", () => {
    for (const message of [
      undefined,
      "goto",
      { type: "goto" },
      { type: "goto", slide: "bad id" },
      { type: "goto", slide: "x".repeat(65) },
      { type: "reset", started: -1 },
      { type: "reset", started: Number.NaN },
      { type: "state", slide: 3 },
      { type: "unknown", slide: "slide-2" },
    ])
      expect(logic.sync(show, message)).toEqual({ show, changed: false })
  })

  test("formats the elapsed time", () => {
    expect(logic.clock(0)).toBe("0:00")
    expect(logic.clock(65_400)).toBe("1:05")
    expect(logic.clock(3_725_000)).toBe("1:02:05")
    expect(logic.clock(-5)).toBe("0:00")
  })

  test("survives serialization into the presentation page", () => {
    const serialized = (new Function(`return (${deck.toString()})`)() as typeof deck)()
    expect(serialized.step({ key: "End" }, 0, 5)).toBe(4)
    expect(serialized.sync(show, { type: "goto", slide: "slide-4" }).show.slide).toBe("slide-4")
  })
})

describe("presentation export and playbook", () => {
  test("design_export accepts the pdf format", () => {
    const input = Schema.decodeUnknownSync(Schema.Struct({ id: Design.ID, input: Design.Render }))({
      id: "design_deck",
      input: { revision: "rev_1", format: "pdf" },
    })
    expect(input.input.format).toBe("pdf")
    expect(Design.exportFile("pdf")).toEqual({ extension: "pdf", mime: "application/pdf" })
    expect(Design.exportFile("audit").extension).toBe("html")
  })

  test("a presentation routes to the slides playbook, which covers notes, presenting and the PDF", () => {
    expect(DesignPlaybooks.forTarget("presentation")).toEqual(["slides"])
    const playbook = DesignPlaybooks.render(DesignPlaybooks.find("slides")!)
    for (const phrase of [
      '<section class="slide">',
      '<aside class="notes">',
      "1920×1080",
      "One idea per slide",
      'format: "pdf"',
      "presenter view",
      "slide-overflow",
    ])
      expect(playbook).toContain(phrase)
  })

  test("the exported page of a presentation runs the slide runtime ahead of the screens", () => {
    const html = injectScreens("<!doctype html><html><head></head><body></body></html>", "presentation")
    const runtime = html.indexOf(`(${slides.toString()})(${deck.toString()})`)
    expect(runtime).toBeGreaterThan(0)
    expect(runtime).toBeLessThan(html.indexOf(`(${screens.toString()})()`))
    expect(injectScreens("<p>Web</p>", "web")).not.toContain("__redcodeSlides")
  })
})

describe("in the browser", () => {
  let browser: Browser
  beforeAll(async () => {
    browser = await chromium.launch()
  }, 30000)
  afterAll(async () => {
    await browser?.close()
  })

  const open = async (body: string) => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    await page.setContent(
      `<!doctype html><html><head><script>(${slides.toString()})(${deck.toString()});(${screens.toString()})()</script></head><body>${body}</body></html>`,
    )
    return page
  }

  test("each slide is a numbered screen, the keys move between them and notes stay hidden", async () => {
    const page = await open(
      `<section class="slide"><h1>Intro</h1><aside class="notes">Welcome everyone</aside></section><section class="slide" id="pricing"><h2>Pricing</h2></section><section class="slide"><h1>Ask</h1></section>`,
    )
    try {
      const shown = () =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("section.slide")]
            .filter((node) => node.checkVisibility())
            .map((node) => node.dataset.designScreen),
        )
      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("section.slide")].map(
            (node) => `${node.dataset.designScreen} ${node.dataset.designLabel}`,
          ),
        ),
      ).toEqual(["slide-1 1. Intro", "pricing 2. Pricing", "slide-3 3. Ask"])
      expect(await shown()).toEqual(["slide-1"])
      expect(await page.locator("aside.notes").isVisible()).toBe(false)
      await page.keyboard.press("ArrowRight")
      expect(await shown()).toEqual(["pricing"])
      await page.keyboard.press("End")
      expect(await shown()).toEqual(["slide-3"])
      await page.keyboard.press("PageUp")
      expect(await shown()).toEqual(["pricing"])
      await page.keyboard.press("Home")
      expect(await shown()).toEqual(["slide-1"])
      expect(
        await page.evaluate(() => {
          const box = document.querySelector("section.slide")!.getBoundingClientRect()
          return [box.width, box.height]
        }),
      ).toEqual([1920, 1080])
      // Printing shows every slide at once.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("design:print")))
      expect(await shown()).toEqual(["slide-1", "pricing", "slide-3"])
    } finally {
      await page.close()
    }
  })

  test("the slide audit flags content leaving the slide and text too small to project", async () => {
    const page = await open(
      `<section class="slide" id="fits"><h1 style="font-size:72px">Fits</h1><p style="font-size:32px">Readable</p></section><section class="slide" id="spills"><h1 style="font-size:72px">Spills</h1><p id="tiny" style="font-size:14px">Fine print</p><div id="tall" style="height:1400px;font-size:32px">Too much</div><aside class="notes" style="font-size:10px">Notes are not checked</aside></section>`,
    )
    try {
      expect(await page.evaluate(DesignQuality.slide, 24)).toEqual([])
      await page.evaluate(() => (window as unknown as { design: { go: (id: string) => void } }).design.go("spills"))
      const checks = await page.evaluate(DesignQuality.slide, 24)
      expect(checks.filter((check) => check.rule === "slide-overflow").map((check) => check.selector)).toEqual([
        "#tall",
      ])
      expect(checks.find((check) => check.rule === "slide-overflow")?.severity).toBe("error")
      expect(checks.filter((check) => check.rule === "slide-text-small").map((check) => check.selector)).toEqual([
        "#tiny",
      ])
    } finally {
      await page.close()
    }
  })

  test("a slide grown past its canvas is flagged even when nothing inside crosses its edge", async () => {
    const page = await open(
      `<style>section.slide#grown{height:auto!important}</style><section class="slide" id="grown"><div style="height:1300px;font-size:32px">Long</div></section>`,
    )
    try {
      const checks = await page.evaluate(DesignQuality.slide, 24)
      expect(checks.map((check) => `${check.rule} ${check.selector}`)).toEqual(["slide-overflow #grown"])
    } finally {
      await page.close()
    }
  })
})
