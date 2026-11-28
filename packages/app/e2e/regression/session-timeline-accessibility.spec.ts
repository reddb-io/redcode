import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, shell, textPart, userMessage } from "../utils/timeline"

test("space activates a focused timeline button instead of scrolling", async ({ page }) => {
  const shellID = "prt_space_button_shell"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        shell(shellID, "completed", lines(5)),
        textPart(
          "prt_space_following",
          "Following content leaves room to focus the command away from the bottom. ".repeat(40),
        ),
      ]),
    ],
    settings: { shellToolPartsExpanded: false },
    reducedMotion: true,
    seedHistory: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const trigger = page.getByRole("button", { name: /^Worked for .*Ran 1 command$/ })
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(300)
  await trigger.scrollIntoViewIfNeeded()
  await scroller.hover()
  await page.mouse.wheel(0, -100)
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeGreaterThan(50)
  await expect(trigger).toBeInViewport()
  await trigger.focus()
  await expect(trigger).toBeFocused()
  const before = await scroller.evaluate((element) => element.scrollTop)
  await trigger.press("Space")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(before)
})

test("opens a sent image with Space and restores focus after the preview closes", async ({ page }) => {
  const message = userMessage([
    {
      id: "prt_sent_image",
      type: "file",
      filename: "pixel.png",
      mime: "image/png",
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSysAAAAASUVORK5CYII=",
    },
  ])
  await setupTimeline(page, { messages: [message, assistantMessage()] })
  const image = page.getByRole("button", { name: "pixel.png", exact: true })
  await image.press("Space")
  const preview = page.getByRole("dialog", { name: "pixel.png", exact: true })
  await expect(preview.getByRole("img", { name: "pixel.png" })).toHaveJSProperty("naturalWidth", 1)
  await preview.getByRole("button", { name: "Close", exact: true }).click()
  await expect(preview).toBeHidden()
  await expect(image).toBeFocused()
})

test("scrolling a focused tool out of the mounted rows keeps the timeline at its new position", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        shell("prt_scrolled_shell", "completed", lines(5)),
        textPart("prt_scrolled_latest", "Latest response."),
      ]),
    ],
    settings: { shellToolPartsExpanded: false },
    reducedMotion: true,
    seedHistory: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const trigger = page.getByRole("button", { name: /^Worked for .*Ran 1 command$/ })
  await expect(trigger).toBeInViewport()
  await trigger.focus()
  await expect(trigger).toBeFocused()
  await scroller.hover()
  await page.mouse.wheel(0, -100_000)
  await expect(trigger).toHaveCount(0)
  await expect(scroller).toBeFocused()
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0)
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}
