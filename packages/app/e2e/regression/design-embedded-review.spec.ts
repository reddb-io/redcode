import { expect, test } from "@playwright/test"
import { reviewCopy } from "../../../core/src/design/ui/copy"
import { openDesignReview } from "../utils/design-review"

test("canvas zoom and pan keep annotations anchored and preserve the prototype and draft", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const review = await openDesignReview(page, true, { target: "creative", published: true })
  const prototype = page.frameLocator("#preview")
  const field = prototype.getByRole("textbox", { name: "Prototype state", exact: true })
  await expect(field).toBeVisible()
  await field.fill("Keep prototype state")
  await review.getByRole("button", { name: reviewCopy.canvasActual, exact: true }).click()
  await expect(review.locator("#canvas-scale")).toHaveText("100%")
  await review.getByRole("button", { name: reviewCopy.annotate, exact: true }).click()
  const target = prototype.getByRole("button", { name: "Checkout action", exact: true })
  await target.click()
  const note = review.getByRole("textbox", { name: reviewCopy.cardNote, exact: true })
  await expect(note).toBeFocused()
  await note.fill("Keep the annotation draft")
  const aligned = async () => {
    const anchor = await target.boundingBox()
    const card = await review.locator("#card").boundingBox()
    return !!anchor && !!card && Math.abs(card.y - anchor.y - anchor.height - 8) <= 1
  }
  await expect.poll(aligned).toBe(true)
  await review.getByRole("button", { name: reviewCopy.canvasZoomIn, exact: true }).click()
  await expect(review.locator("#canvas-scale")).toHaveText("125%")
  await expect.poll(aligned).toBe(true)
  await expect(note).toHaveValue("Keep the annotation draft")
  const pan = review.getByRole("button", { name: reviewCopy.canvasPan, exact: true })
  await pan.click()
  await expect(review.getByRole("button", { name: reviewCopy.annotate, exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  )
  const viewport = review.locator("#preview-device").locator("..")
  await viewport.focus()
  const before = await target.boundingBox()
  await viewport.press("ArrowRight")
  await expect.poll(async () => (await target.boundingBox())!.x - before!.x).toBe(32)
  await expect.poll(aligned).toBe(true)
  await viewport.press("0")
  await expect(review.getByRole("button", { name: reviewCopy.canvasFit, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(note).toHaveValue("Keep the annotation draft")
  await pan.click()
  await expect(field).toHaveValue("Keep prototype state")
  await page.getByRole("textbox", { name: "Adjacent chat" }).fill("+")
  const scale = await review.locator("#canvas-scale").textContent()
  await page.getByRole("textbox", { name: "Adjacent chat" }).press("-")
  await expect(review.locator("#canvas-scale")).toHaveText(scale!)
  expect(errors).toEqual([])
  await page.screenshot({ path: test.info().outputPath("design-canvas-annotation.png"), animations: "disabled" })
})

for (const assessment of ["completed", "unavailable"] as const) {
  test(`design evidence distinguishes measured checks from a ${assessment} assessment`, async ({ page }) => {
    const review = await openDesignReview(page, true, { published: true, assessment })
    await review.getByRole("tab", { name: reviewCopy.assets, exact: true }).click()
    const evidence = review.locator("[data-review-evidence]")
    await expect(evidence.getByRole("heading", { name: reviewCopy.qualityChecks, exact: true })).toBeVisible()
    await expect(evidence.getByRole("definition")).toHaveText(["0", "1", "0"])
    await expect(evidence.getByRole("meter", { name: reviewCopy.qualityReuse, exact: true })).toHaveAttribute(
      "value",
      "75",
    )
    await evidence.getByText("small-control · Needs review · 390px", { exact: true }).click()
    await expect(evidence.getByText("Target is 20px high.", { exact: true })).toBeVisible()
    const refresh = review.getByRole("button", { name: reviewCopy.refresh, exact: true })
    const refreshed = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/design_inspector/job"),
    )
    await refresh.click()
    await refreshed
    await expect(refresh).not.toHaveAttribute("aria-busy", "true")
    await expect(evidence.getByText("Target is 20px high.", { exact: true })).toBeVisible()
    await review.getByRole("tab", { name: reviewCopy.feedback, exact: true }).click()
    await review.getByText(reviewCopy.analysisTitle, { exact: true }).click()
    const result = review.locator("#analysis-results")
    if (assessment === "unavailable") {
      await expect(result.getByText(reviewCopy.analysisUnavailable, { exact: true })).toBeVisible()
      await expect(result.getByText("Clear", { exact: true })).toHaveCount(0)
    } else {
      await expect(result.getByText("Clear", { exact: true })).toBeVisible()
      await expect(result.getByText("Keep the primary action prominent.", { exact: true })).toBeVisible()
      await result.getByText(reviewCopy.analysisEvidence, { exact: true }).click()
      await expect(result.getByText("Checkout primary action", { exact: true })).toBeVisible()
    }
    await expect(result.getByText("The payment flow was not exercised.", { exact: true })).toBeVisible()
    if (assessment === "completed")
      await page.screenshot({ path: test.info().outputPath("design-assessment.png"), animations: "disabled" })
  })
}

// Runs the shipping serialized surface: an embedded review must not reconstruct the chat beside it.
for (const embedded of [true, false]) {
  test(`Design ${embedded ? "embedded" : "standalone"} keeps its own review controls and conversation scope`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    const review = await openDesignReview(page, embedded)
    await expect(review.locator("#reply")).toHaveCount(embedded ? 0 : 1)
    await expect(review.locator("#activity")).toHaveCount(embedded ? 0 : 1)
    await expect(review.locator("#round-message")).toHaveCount(embedded ? 0 : 1)
    await expect(review.locator("#note")).toHaveCount(1)
    await expect(review.locator("#preview")).toHaveCount(1)
    await expect(review.locator("#approve")).toHaveCount(1)
    const feedback = review.getByRole("textbox", { name: reviewCopy.notes, exact: true })
    await feedback.fill("Keep the checkout feedback")
    const params = review.getByRole("tab", { name: reviewCopy.params, exact: true })
    await params.click()
    await expect(review.getByRole("tabpanel", { name: reviewCopy.params, exact: true })).toBeVisible()
    await params.press("Home")
    await expect(review.getByRole("tab", { name: reviewCopy.feedback, exact: true })).toBeFocused()
    await expect(feedback).toHaveValue("Keep the checkout feedback")
    await page.getByRole("textbox", { name: "Adjacent chat" }).fill("v")
    await page.getByRole("textbox", { name: "Adjacent chat" }).press("a")
    await expect(page.getByRole("textbox", { name: "Adjacent chat" })).toHaveValue("va")
    await expect(review).toHaveAttribute("data-feed-url", `/review-api/feed${embedded ? "?embed=1" : ""}`)
    expect(errors).toEqual([])
  })
}

test.describe("Design mobile density", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } })

  for (const size of [
    { width: 390, height: 844 },
    { width: 640, height: 360 },
  ])
    test(`keeps the canvas primary and opens its inspector on demand at ${size.width}×${size.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(size)
      const review = await openDesignReview(page, true, { target: "app", published: true })
      const field = page.frameLocator("#preview").getByRole("textbox", { name: "Prototype state", exact: true })
      await expect(field).toBeVisible()
      await field.fill("Preserve the live prototype")
      await expect
        .poll(async () => {
          const host = await review.boundingBox()
          const canvas = await review.locator("#stage").boundingBox()
          return canvas!.height / host!.height
        })
        .toBeGreaterThan(0.65)
      await expect.poll(async () => (await review.locator("#toolbar").boundingBox())!.height).toBeLessThanOrEqual(60)
      await expect(review.locator("#inspector")).toBeHidden()
      const inspect = review.getByRole("button", { name: reviewCopy.inspector, exact: true })
      await expect(inspect).toBeEnabled()
      await page.screenshot({ path: test.info().outputPath("design-mobile-canvas.png"), animations: "disabled" })
      await inspect.tap()
      const sheet = review.getByRole("dialog", { name: reviewCopy.inspector, exact: true })
      await expect(sheet).toBeVisible()
      await expect.poll(async () => (await sheet.boundingBox())!.height).toBeLessThanOrEqual(size.height)
      await review.getByRole("textbox", { name: reviewCopy.notes, exact: true }).fill("Keep this feedback")
      await page.screenshot({ path: test.info().outputPath("design-mobile-inspector.png"), animations: "disabled" })
      await sheet.getByRole("button", { name: reviewCopy.closeInspector, exact: true }).tap()
      await expect(sheet).toBeHidden()
      await expect(inspect).toBeFocused()
      await expect(field).toHaveValue("Preserve the live prototype")
      await review.getByRole("button", { name: reviewCopy.more, exact: true }).tap()
      await expect(review.getByRole("menuitem", { name: reviewCopy.approve, exact: true })).toBeEnabled()
      await review.getByRole("menuitem", { name: reviewCopy.previewSettings, exact: true }).tap()
      await expect(sheet).toBeVisible()
      await expect(sheet.getByRole("combobox", { name: reviewCopy.history, exact: true })).toBeVisible()
      await expect(sheet.getByRole("button", { name: reviewCopy.platformAndroid, exact: true })).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(sheet).toBeHidden()
      await inspect.tap()
      await page.setViewportSize({ width: 1200, height: 900 })
      await expect(sheet).toBeHidden()
      await expect(review.locator("#inspector")).toBeVisible()
      await expect(review.getByRole("combobox", { name: reviewCopy.history, exact: true })).toBeVisible()
      await review.getByRole("tab", { name: reviewCopy.feedback, exact: true }).click()
      await expect(review.getByRole("textbox", { name: reviewCopy.notes, exact: true })).toHaveValue(
        "Keep this feedback",
      )
      await expect(field).toHaveValue("Preserve the live prototype")
      await page.screenshot({ path: test.info().outputPath("design-responsive-inspector.png"), animations: "disabled" })
    })

  test("touch panning moves an app frame without consuming prototype interaction when disabled", async ({ page }) => {
    const review = await openDesignReview(page, true, { target: "app", published: true })
    const prototype = page.frameLocator("#preview")
    await expect(prototype.getByRole("button", { name: "Checkout action", exact: true })).toBeVisible()
    const pan = review.getByRole("button", { name: reviewCopy.canvasPan, exact: true })
    await pan.tap()
    await expect(pan).toHaveAttribute("aria-pressed", "true")
    const viewport = review.locator("#preview-device").locator("..")
    const bounds = await viewport.boundingBox()
    const before = await prototype.getByRole("button", { name: "Checkout action", exact: true }).boundingBox()
    const client = await page.context().newCDPSession(page)
    await client.send("Input.synthesizeScrollGesture", {
      x: bounds!.x + bounds!.width / 2,
      y: bounds!.y + bounds!.height / 2,
      xDistance: 40,
      yDistance: 24,
      gestureSourceType: "touch",
      preventFling: true,
      speed: 200,
    })
    await expect
      .poll(
        async () =>
          (await prototype.getByRole("button", { name: "Checkout action", exact: true }).boundingBox())!.x - before!.x,
      )
      .toBeGreaterThan(0)
    await review.getByRole("button", { name: reviewCopy.canvasFit, exact: true }).tap()
    await expect(review.getByRole("button", { name: reviewCopy.canvasFit, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await pan.tap()
    await expect(pan).toHaveAttribute("aria-pressed", "false")
    await client.detach()
    await expect(review.getByRole("button", { name: reviewCopy.canvasFit, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    const field = prototype.getByRole("textbox", { name: "Prototype state", exact: true })
    await field.tap()
    await field.fill("Touch prototype")
    await expect(field).toHaveValue("Touch prototype")
    await expect
      .poll(async () => {
        const area = await viewport.boundingBox()
        const device = await review.locator("#preview-device").boundingBox()
        return !!area && !!device && device.y >= area.y && device.y + device.height <= area.y + area.height
      })
      .toBe(true)
    await page.screenshot({ path: test.info().outputPath("design-touch-canvas.png"), animations: "disabled" })
  })

  test("inherits the host density and preserves mobile toolbar touch targets", async ({ page }) => {
    const review = await openDesignReview(page, true)
    await expect(review).toHaveAttribute("data-density", "tiny")
    const more = review.getByRole("button", { name: reviewCopy.more, exact: true })
    await expect.poll(async () => (await more.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(44)
    await expect.poll(async () => (await more.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    await expect(review.locator("#note")).toHaveCSS("font-size", "16px")
    await more.click()
    await expect(review.getByRole("menuitem", { name: reviewCopy.share, exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(more).toHaveAttribute("aria-expanded", "false")
    await review.getByRole("button", { name: reviewCopy.inspector, exact: true }).tap()
    const assets = review.getByRole("tab", { name: reviewCopy.assets, exact: true })
    await assets.tap()
    await expect.poll(async () => (await assets.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    const panel = review.getByRole("tabpanel", { name: reviewCopy.assets, exact: true })
    await assets.press("Tab")
    await expect(panel).toBeFocused()
    await panel.press("End")
    await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(assets).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath("design-mobile-density.png"), animations: "disabled" })

    await page.evaluate(() => {
      document.documentElement.dataset.density = "comfortable"
    })
    await expect(review).toHaveAttribute("data-density", "comfortable")
    await page.evaluate(() => {
      delete document.documentElement.dataset.density
    })
    await expect(review).toHaveAttribute("data-density", "tiny")
    await page.setViewportSize({ width: 1024, height: 800 })
    await expect(review).toHaveAttribute("data-density", "compact")
  })
})
