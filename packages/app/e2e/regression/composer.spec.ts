import { expect, test, type Locator, type Page } from "@playwright/test"
import { NO_PROVIDER, T0, provider } from "../utils/app"
import { openDraft, openSession } from "../utils/workspace"

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

test("Shift+Tab cycles primary agents while preserving the prompt", async ({ page }) => {
  const { editor } = await openDraft(page, {
    name: "AgentCycle",
    agents: ["build", "plan"].map((id) => ({
      id,
      name: id === "build" ? "Build" : "Plan",
      mode: "primary",
      hidden: false,
      request: { settings: {}, headers: {}, body: {} },
      permissions: [],
    })),
  })
  await expect(page.getByRole("button", { name: "Choose agent", exact: true })).toHaveText("build")
  await editor.fill("Keep the draft while changing agents")
  await editor.press("Shift+Tab")
  await expect(page.getByRole("button", { name: "Choose agent", exact: true })).toHaveText("plan")
  await expect(editor).toHaveText("Keep the draft while changing agents")
  await expect(editor).toBeFocused()
  await editor.press("Shift+Tab")
  await expect(page.getByRole("button", { name: "Choose agent", exact: true })).toHaveText("build")
})

test("a draft applies dual reasoning before admitting its first prompt", async ({ page }) => {
  const mode = Promise.withResolvers<void>()
  const changed: { sessionID: string; body: unknown }[] = []
  const prompts: string[] = []
  const { editor } = await openDraft(page, {
    name: "DualReasoning",
    onReasoningMode: async (input) => {
      changed.push(input)
      await mode.promise
    },
    onPrompt: ({ sessionID }) => prompts.push(sessionID),
  })
  await page.getByRole("button", { name: "Reasoning mode", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Dual · S1 evaluates S2", exact: true }).click()
  await editor.fill("Evaluate this carefully")
  await editor.press("Enter")
  await expect.poll(() => changed.length).toBe(1)
  expect(changed[0]?.body).toEqual({ reasoning: "dual" })
  expect(prompts).toEqual([])
  await expect(page).toHaveURL(/\/new-session\?/)
  mode.resolve()
  await expect.poll(() => prompts).toEqual([changed[0]!.sessionID])
  await expect(page).toHaveURL(new RegExp(`/session/${changed[0]!.sessionID}$`))
})

test("a reasoning failure keeps the draft and its prompt recoverable", async ({ page }) => {
  const requests: unknown[] = []
  const prompts: string[] = []
  const { editor } = await openDraft(page, {
    name: "ReasoningRetry",
    onReasoningMode: ({ body }) => {
      requests.push(body)
      if (requests.length === 1) throw new Error("Evaluator unavailable")
    },
    onPrompt: ({ sessionID }) => prompts.push(sessionID),
  })
  await page.getByRole("button", { name: "Reasoning mode", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Dual · S1 evaluates S2", exact: true }).click()
  await editor.fill("Keep this prompt")
  await editor.press("Enter")
  await expect(page.getByText("Could not change the reasoning mode", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/new-session\?/)
  await expect(editor).toHaveText("Keep this prompt")
  expect(prompts).toEqual([])
  await editor.press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  expect(requests).toEqual([{ reasoning: "dual" }, { reasoning: "dual" }])
})

async function draft(page: Page) {
  const { editor } = await openDraft(page, { name: "ComposerDraft", provider: NO_PROVIDER })
  await editor.click()

  return editor
}

async function expectCaretVisible(input: Locator) {
  await expect
    .poll(() =>
      input.evaluate((element) => {
        const selection = window.getSelection()

        if (!selection?.isCollapsed || !selection.rangeCount || !element.contains(selection.anchorNode)) return false
        const caret = selection.getRangeAt(0).getBoundingClientRect()
        const viewport = (element.closest("[data-scrollable]") ?? element).getBoundingClientRect()

        return caret.height > 0 && caret.top >= viewport.top - 1 && caret.bottom <= viewport.bottom + 1
      }),
    )
    .toBe(true)
}

test("keeps a 25000-line crash report editable in a new session", async ({ page }) => {
  const input = await draft(page)
  const text = "Thread 0 Crashed:\n" + "0   Example  0x0000000100000000 frame + 32\n".repeat(25000) + "End of report"
  await page.evaluate((text) => navigator.clipboard.writeText(text), text)

  const events = await input.evaluateHandle((element) => {
    const events = { count: 0 }
    element.addEventListener("input", () => events.count++)

    return events
  })

  await page.keyboard.press("ControlOrMeta+V")
  await expect.poll(async () => (await input.innerText()) === text).toBe(true)
  expect(await events.evaluate((events) => events.count)).toBe(1)
  await expect(input).toBeFocused()
  await expectCaretVisible(input)
  const scroll = page.locator('[data-component="composer-scroll"]')
  await expect(scroll.locator(".scroll-view__viewport")).toHaveCSS("scrollbar-width", "none")
  await expect(scroll.locator(".scroll-view__thumb")).toBeVisible()
  await page.keyboard.type("!")
  await expect.poll(async () => (await input.innerText()) === text + "!").toBe(true)
  await expectCaretVisible(input)
  const thumb = await scroll.locator(".scroll-view__thumb").boundingBox()
  const bounds = await scroll.boundingBox()

  if (!thumb || !bounds) throw new Error("Missing composer scrollbar bounds")
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2)
  await page.mouse.down()
  await page.mouse.move(thumb.x + thumb.width / 2, bounds.y + 8 + thumb.height / 2)
  await page.mouse.up()
  await expect(scroll.locator(".scroll-view__viewport")).toHaveJSProperty("scrollTop", 0)
  await expect(input).toBeFocused()
  await page.keyboard.press("ControlOrMeta+Home")
  await page.keyboard.press("ControlOrMeta+End")
  await expectCaretVisible(input)
})

test("a key-up never moves the caret back after later navigation", async ({ page }) => {
  const input = await draft(page)
  await input.pressSequentially("first line")
  await expect(input).toHaveText("first line")

  // Navigation can land before the next frame; the cursor a key-up recorded must not overwrite it there.
  const offset = await input.evaluate(async (element) => {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!
    const selection = window.getSelection()!
    selection.collapse(text, 0)
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Home", bubbles: true }))
    selection.collapse(text, text.textContent!.length)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    return selection.anchorOffset
  })

  expect(offset).toBe("first line".length)
})

for (const [width, direction] of [
  [390, "rtl"],
  [1280, "ltr"],
] as const) {
  test(`reveals a multiline paste in the middle at ${width}px in ${direction}`, async ({ page }) => {
    const input = await draft(page)
    await page.setViewportSize({ width, height: 800 })
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
    const suffix = "\nExisting trailing content".repeat(100)
    await input.fill("Before " + suffix)
    await input.press("ControlOrMeta+Home")
    await input.press("ArrowRight")
    const text = "Pasted line /tmp/example.ts 123 \u0645\u0631\u062d\u0628\u0627\n".repeat(100) + "End of paste"
    await page.evaluate((text) => navigator.clipboard.writeText(text), text)
    await page.keyboard.press("ControlOrMeta+V")
    await expect.poll(() => input.innerText()).toBe("B" + text + "efore " + suffix)
    await expectCaretVisible(input)
    await page.keyboard.type("!")
    await expect.poll(() => input.innerText()).toBe("B" + text + "!efore " + suffix)
    await expectCaretVisible(input)
  })
}

test("pastes plain text without markup and keeps native undo", async ({ page }) => {
  const input = await draft(page)

  for (const text of [
    "single line <b> &amp;",
    "first\nsecond",
    "\n\n  indented\ttext  \n\nlast\n\n",
    'literal <b>bold</b> &amp; & < > "quotes"\n<script>not code</script>\n<img src="example">',
    "first\r\nsecond\rthird",
  ]) {
    await page.evaluate((text) => navigator.clipboard.writeText(text), text)
    await page.keyboard.press("ControlOrMeta+V")
    const expected = text.replace(/\r\n?/g, "\n")
    await expect.poll(() => input.innerText()).toBe(expected)
    await expect(input.locator("b, script, img")).toHaveCount(0)
    await page.keyboard.press("ControlOrMeta+Z")
    await expect(input).toBeEmpty()
    await page.keyboard.press("ControlOrMeta+Shift+Z")
    await expect.poll(() => input.innerText()).toBe(expected)
    await page.keyboard.press("ControlOrMeta+Z")
    await expect(input).toBeEmpty()
  }
})

test("replaces only the selected text and leaves the caret after the paste", async ({ page }) => {
  const input = await draft(page)
  await page.evaluate(() => navigator.clipboard.writeText("one\ntwo"))
  await page.keyboard.type("before replace after")
  await expect(input).toHaveText("before replace after")
  await page.evaluate(() => document.fonts.ready)

  const word = await input.evaluate((element) => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 7)
    range.setEnd(element.firstChild!, 14)
    const rect = range.getBoundingClientRect()

    return { x: rect.x, y: rect.y + rect.height / 2, width: rect.width }
  })

  await page.mouse.move(word.x, word.y)
  await page.mouse.down()
  await page.mouse.move(word.x + word.width, word.y, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("replace")
  await page.keyboard.press("ControlOrMeta+V")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo after")
  await page.keyboard.press("ControlOrMeta+Z")
  await expect(input).toHaveText("before replace after")
  await page.keyboard.press("ControlOrMeta+Shift+Z")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo after")
  await page.keyboard.type("!")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo! after")
})

test("shows the dropzone and attaches a dropped file", async ({ page }) => {
  const writes: { path: string; directory: string; body: string }[] = []
  await openDraft(page, {
    name: "ComposerDraft",
    provider: NO_PROVIDER,
    onFileWrite: (write) => void writes.push(write),
  })
  const surface = page.locator('[data-component="new-session"]')
  const dropzone = page.locator('[data-component="session-dropzone"]')

  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer()
    value.items.add(new File(["Dropzone fixture"], "dropzone.txt", { type: "text/plain" }))

    return value
  })

  await expect(dropzone).toHaveCount(0)
  await surface.dispatchEvent("dragover", { dataTransfer: transfer })
  await expect(dropzone).toHaveAttribute("data-visible", "true")
  await expect(dropzone).toContainText("Drop files to add")

  await surface.dispatchEvent("drop", { dataTransfer: transfer })
  await expect(page.locator('[data-component="composer-attachments"]')).toContainText("dropzone.txt")
  await expect(dropzone).toHaveCount(0)
  // The file is uploaded to its own directory in the server's temporary directory, then attached by path.
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: expect.stringMatching(/\/uploads\/[0-9a-f-]{36}\/dropzone\.txt$/),
        directory: "C:/OpenCode/ComposerDraft",
        body: "Dropzone fixture",
      },
    ])
  await expect(page.locator('[data-component="upload-progress"]')).toHaveCount(0)
  await expect(page.locator('[data-component="composer-attachments"]')).toContainText("dropzone.txt")
})

test("keeps a narrow session composer contained when invoking a built-in", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  const { editor } = await openSession(page, { name: "ComposerCommand", provider: NO_PROVIDER })
  const composer = page.locator('[data-component="composer"]')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await editor.fill("keep me")
  await composer.getByRole("button", { name: "Add images and files" }).click()
  await page.getByRole("menuitem", { name: "Commands" }).click()
  await page.locator('[data-suggestion-id="model.choose"]').click()

  const dialog = page.getByRole("dialog", { name: "Select model", exact: true })
  const search = dialog.getByRole("searchbox", { name: "Search models", exact: true })
  await expect(search).toBeFocused()
  await expect(editor).toHaveText("keep me")
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()

  await editor.fill("/model")
  await expect(page.locator('[data-suggestion-id="model.choose"]')).toHaveAttribute("data-active", "")
  await editor.press("Enter")
  await expect(search).toBeFocused()
  await expect(editor).toBeEmpty()
})

test("lists slash commands in their built-in order", async ({ page }) => {
  const { editor } = await openSession(page, {
    name: "ComposerSlash",
    provider: NO_PROVIDER,
    commands: [
      { name: "init", description: "Create AGENTS.md" },
      { name: "review", description: "Review changes" },
    ],
    // A sent message enables /undo, /compact and /fork.
    pageMessages: () => ({ items: [{ id: "msg_slash", type: "user", text: "Hello", time: { created: T0 } }] }),
  })

  await editor.fill("/")
  await expect(page.locator('[data-component="composer-suggestions"] [data-suggestion-id] bdi')).toHaveText([
    "/init",
    "/review",
    "/new",
    "/undo",
    "/compact",
    "/fork",
    "/export",
    "/open",
    "/terminal",
    "/mcp",
    "/model",
    "/connect",
    "/btw",
  ])
})

const followUp = "Add follow-up, / for commands, @ for context…"

for (const row of [
  { state: "an idle", copy: "Ask anything, / for commands, @ for context…" },
  { state: "a running", copy: followUp, sessionStatus: { ses_placeholder: { type: "running" } } },
  {
    state: "an idle queued",
    copy: followUp,
    inbox: [
      {
        id: "inb_placeholder",
        sessionID: "ses_placeholder",
        time: { created: T0 },
        type: "user",
        payload: { text: "Queued follow-up" },
        delivery: "queue",
      },
    ],
  },
]) {
  test(`shows the placeholder for ${row.state} session and the shell example in shell mode`, async ({ page }) => {
    const { editor } = await openSession(page, {
      name: "ComposerPlaceholder",
      sessions: [{ id: "ses_placeholder", title: "Placeholder" }],
      sessionStatus: row.sessionStatus,
      inbox: row.inbox,
    })

    const scroll = page.locator('[data-component="composer-scroll"]')
    await expect(scroll).toHaveText(row.copy)
    await editor.pressSequentially("!")
    await expect(scroll).toHaveText("Enter shell command… git status")
  })
}

test("shows thinking on hover or a non-default selection while preserving keyboard access", async ({ page }) => {
  const { editor: input } = await openSession(page, {
    name: "ComposerThinking",
    provider: provider({ id: "thinking-model", name: "Thinking Model", variants: { high: {} } }),
  })

  const composer = page.locator('[data-component="composer"]')
  const control = composer.getByRole("button", { name: "Choose model variant" })
  const option = (name: string) => page.getByRole("menuitemradio", { name, exact: true })

  await page.mouse.move(0, 0)
  await expect(control).toHaveText("default")
  await expect(control).toHaveCSS("opacity", "0")
  await expect(control).toHaveCSS("pointer-events", "none")

  await input.hover()
  await expect(control).toHaveCSS("opacity", "1")

  // The menu keeps the control visible after the pointer leaves.
  await control.click()
  await expect(option("high")).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(control).toHaveAttribute("aria-expanded", "true")
  await expect(control).toHaveCSS("opacity", "1")
  await option("high").click()

  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("high")
  await expect(control).toHaveCSS("opacity", "1")

  await control.click()
  await option("default").click()
  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("default")
  await expect(control).toHaveCSS("opacity", "0")

  // The single-agent fixture has only Add and Model before the thinking trigger.
  await page.keyboard.press("Tab")
  await expect(composer.getByRole("button", { name: "Add images and files" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(composer.getByRole("button", { name: "Thinking Model" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(control).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Enter")
  await expect(option("default")).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Escape")
  await expect(control).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(control).toHaveCSS("opacity", "0")
})
