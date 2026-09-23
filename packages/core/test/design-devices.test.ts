import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { chromium, type Browser } from "playwright-core"
import { device } from "@reddb-io/redcode-design/devices"
import { stage } from "@reddb-io/redcode-design/stage"
import { viewports } from "@reddb-io/redcode-design/viewports"
import { DesignQuality } from "../src/design/quality"

const fixture = (name: string) => Bun.file(path.join(import.meta.dir, "fixture", "design-devices", name)).text()

describe("device frames", () => {
  // Golden copies of the frame markup: a change to a frame shows up here as a reviewable diff.
  test.each(["ios", "android"] as const)("the %s frame matches its golden markup", async (platform) => {
    expect(device(platform).html).toBe(await fixture(`${platform}.html`))
  })

  test("each frame draws its platform's chrome around the audited phone", () => {
    const ios = device("ios")
    const android = device("android")
    expect([ios.width, ios.height, ios.scale, ios.touch]).toEqual([393, 852, 3, 44])
    expect([android.width, android.height, android.scale, android.touch]).toEqual([412, 915, 2.625, 48])
    for (const phone of [ios, android]) {
      expect(viewports("app", phone.platform)).toEqual([
        { width: phone.width, height: phone.height, device: phone.platform },
      ])
      expect(phone.html).toContain(`width:${phone.width}px;height:${phone.height}px`)
      expect(phone.html).toContain("9:41")
      expect(phone.html).not.toMatch(/<img|url\(|https?:/)
    }
    expect(ios.userAgent).toContain("iPhone")
    expect(android.userAgent).toContain("Android")
    // The Dynamic Island is a wide pill; the Android camera is a round punch hole.
    expect(ios.html).toContain("width:126px;height:37px")
    expect(android.html).toContain("width:18px;height:18px;margin-left:-9px;border-radius:50%")
  })

  test("survives serialization into the review page", () => {
    const serialized = new Function(`return (${device.toString()})`)() as typeof device
    expect(serialized("android")).toEqual(device("android"))
  })
})

describe("preview stage", () => {
  const geometry = stage()

  test("scales a phone frame down to fit its pane, centered, and never up", () => {
    const phone = { width: 417, height: 876 }
    const fitted = geometry.fit(phone, { width: 500, height: 600 }, 12)
    expect(fitted.scale).toBeCloseTo(576 / 876)
    expect(fitted.y).toBeCloseTo(12)
    expect(fitted.x).toBeCloseTo((500 - 417 * fitted.scale) / 2)
    expect(geometry.fit(phone, { width: 2000, height: 2000 })).toEqual({
      scale: 1,
      x: (2000 - 417) / 2,
      y: (2000 - 876) / 2,
    })
    expect(geometry.fit(phone, { width: 0, height: 0 }).scale).toBe(1)
  })

  test("places a note card under the element of a scaled frame, in pane coordinates", () => {
    // A frame drawn at half size whose top-left corner sits at (106, 26) in the pane.
    const at = { scale: 0.5, x: 106, y: 26 }
    const card = { width: 200, height: 80 }
    const bounds = { width: 800, height: 600 }
    const rect = { x: 40, y: 100, width: 80, height: 30 }
    expect(geometry.project(rect, at)).toEqual({ x: 126, y: 76, width: 40, height: 15 })
    expect(geometry.anchor(rect, at, card, bounds)).toEqual({ left: 126, top: 99 })
    // No room below: the card goes above the element.
    expect(
      geometry.anchor({ x: 10, y: 1000, width: 50, height: 40 }, { scale: 0.5, x: 0, y: 0 }, card, bounds),
    ).toEqual({ left: 5, top: 412 })
    // Past the right edge: the card stays inside the pane.
    expect(
      geometry.anchor({ x: 1500, y: 0, width: 10, height: 10 }, { scale: 0.5, x: 0, y: 0 }, card, bounds).left,
    ).toBe(600)
  })

  test("an unscaled frame keeps the offset-only placement", () => {
    const at = { scale: 1, x: 24, y: 10 }
    expect(
      geometry.anchor(
        { x: 30, y: 40, width: 100, height: 20 },
        at,
        { width: 200, height: 80 },
        { width: 900, height: 700 },
      ),
    ).toEqual({ left: 54, top: 78 })
  })

  test("survives serialization into the review page", () => {
    const serialized = (new Function(`return (${stage.toString()})`)() as typeof stage)()
    expect(
      serialized.anchor(
        { x: 40, y: 100, width: 80, height: 30 },
        { scale: 0.5, x: 106, y: 26 },
        { width: 200, height: 80 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 126, top: 99 })
  })
})

describe("small-control thresholds", () => {
  let browser: Browser
  beforeAll(async () => {
    browser = await chromium.launch()
  }, 30000)
  afterAll(async () => {
    await browser?.close()
  })

  test("follow each platform's touch target", () => {
    expect(DesignQuality.minimumControl(undefined)).toBe(24)
    expect(DesignQuality.minimumControl("ios")).toBe(44)
    expect(DesignQuality.minimumControl("android")).toBe(48)
  })

  test("flag controls below the web target, the iOS 44pt and the Android 48dp targets", async () => {
    const page = await browser.newPage()
    try {
      await page.setContent(
        `<!doctype html><body><button id="tiny" style="height:20px;width:120px">Tiny</button><button id="web" style="height:40px;width:120px">Web</button><button id="ios" style="height:46px;width:120px">iOS</button><button id="narrow" style="height:60px;width:30px">Narrow</button><button id="large" style="height:56px;width:120px">Large</button></body>`,
      )
      const flagged = async (minimum?: number) =>
        (await page.evaluate(DesignQuality.inspect, minimum))
          .filter((check) => check.rule === "small-control")
          .map((check) => check.selector)
          .sort()
      expect(await flagged()).toEqual(["#tiny"])
      expect(await flagged(DesignQuality.minimumControl("ios"))).toEqual(["#narrow", "#tiny", "#web"])
      expect(await flagged(DesignQuality.minimumControl("android"))).toEqual(["#ios", "#narrow", "#tiny", "#web"])
      const evidence = (await page.evaluate(DesignQuality.inspect, 48)).find(
        (check) => check.rule === "small-control" && check.selector === "#ios",
      )
      expect(evidence?.evidence).toBe("Control is 120×46px, under the 48px touch target.")
    } finally {
      await page.close()
    }
  })
})
