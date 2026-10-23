import { expect, test, type Page } from "@playwright/test"
import { holdRoute, SERVER, sessionHref } from "../utils/app"
import { installSseTransport } from "../utils/sse-transport"
import { APP_READY_TIMEOUT, expectSessionTitle } from "../utils/waits"
import { mockWorkspace, type WorkspaceInput } from "../utils/workspace"
import { questionRequestForm, vaultRequestForm, webSearchRequestForm } from "../utils/request-forms"

const directory = "C:/OpenCode/RequestDocks"

const sessionID = "ses_request_docks"

const title = "Request dock regression"

test.use({ serviceWorkers: "block" })

test("question drafts retain keyboard choices, custom answers and progress through minimization, navigation and retry", async ({
  page,
}, testInfo) => {
  const form = questionRequestForm(sessionID)
  const forms = [form]
  const otherID = "ses_request_docks_other"
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const replies: unknown[] = []
  const answer = { q0: "minimal", q1: ["unit", "browser", "manual audit"], q2: "manual" }
  const workspace = await mockServer(page, {
    sessions: [
      { id: sessionID, title },
      { id: otherID, title: "Other question session" },
    ],
    forms: () => forms,
    onFormReply: (input) => {
      replies.push(input.body)
      if (replies.length === 1) return { status: 500, body: { message: "Fixture question reply unavailable" } }
      forms.splice(0)
    },
  })
  const held = await holdRoute(page, (url) => url.pathname.endsWith(`/form/${form.id}/reply`), { method: "POST" })
  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)
  const question = page.locator('[data-component="dock-prompt"][data-kind="question"]')
  const minimal = question.getByRole("radio", { name: /Minimal/ })
  await expect(minimal).toBeFocused()
  await expect(page.locator('[data-component="composer"]')).toHaveCount(0)
  const rejected: string[] = []
  page.on("request", (request) => {
    if (request.method() === "DELETE" && new URL(request.url()).pathname.endsWith(`/form/${form.id}`))
      rejected.push(request.url())
  })
  await question.getByRole("button", { name: "Minimize question", exact: true }).click()
  await expect(question.getByText("Which implementation should be used?", { exact: true })).toBeVisible()
  await expect(minimal).toBeHidden()
  await expect(question.getByText("Select one answer", { exact: true })).toBeHidden()
  const restore = question.getByRole("button", { name: "Restore question", exact: true })
  await expect(restore).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(question.getByRole("button", { name: "Dismiss", exact: true })).toBeFocused()
  await restore.click()
  await expect(minimal).toBeFocused()
  await minimal.press("ArrowDown")
  const extended = question.getByRole("radio", { name: /Extended/ })
  await expect(extended).toBeFocused()
  await expect(extended).toHaveAttribute("aria-checked", "false")
  await extended.press("Home")
  await expect(minimal).toBeFocused()
  await minimal.press("Enter")
  await expect(minimal).toHaveAttribute("aria-checked", "true")
  await question.getByRole("button", { name: "Next", exact: true }).click()
  const unit = question.getByRole("checkbox", { name: "Unit tests", exact: true })
  await expect(unit).toBeFocused()
  await unit.click()
  await question.getByRole("checkbox", { name: "Browser checks", exact: true }).click()
  const custom = question.getByRole("checkbox", { name: /Type your own answer/ })
  await custom.click()
  const input = question.getByPlaceholder("Type your answer…", { exact: true })
  await expect(input).toBeFocused()
  await input.fill("manual audit")
  await expect(question.locator('[data-slot="question-option-check"]')).toHaveCount(3)
  await expect
    .poll(() =>
      question.locator('[data-slot="question-option-check"]').evaluateAll((elements) => {
        const positions = elements.map((element) => element.getBoundingClientRect().x)
        return Math.max(...positions) - Math.min(...positions)
      }),
    )
    .toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath("question-custom.png") })
  await input.press("Escape")
  await expect(custom).toBeFocused()
  await expect(custom).toHaveAttribute("aria-checked", "true")
  expect(rejected).toEqual([])
  await custom.locator('[data-slot="question-option-check"]').click()
  await expect(custom).toHaveAttribute("aria-checked", "false")
  await expect(input).toHaveCount(0)
  await custom.click()
  await expect(input).toHaveValue("manual audit")
  await input.press("Enter")
  await expect(custom).toBeFocused()
  await expect(custom).toHaveAttribute("aria-checked", "true")
  await question.getByRole("button", { name: "Next", exact: true }).click()
  await expect(question.getByRole("radio", { name: "Manual review", exact: true })).toBeFocused()
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(unit).toHaveAttribute("aria-checked", "true")
  await expect(question.getByRole("checkbox", { name: "Browser checks", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  )
  await expect(custom).toHaveAttribute("aria-checked", "true")
  await expect(custom).toContainText("manual audit")
  await question.getByRole("button", { name: "Questions 3", exact: true }).click()
  const manual = question.getByRole("radio", { name: "Manual review", exact: true })
  await manual.click()
  expect(replies).toEqual([])
  const failed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/form/${form.id}/reply`),
  )
  await page.keyboard.press("ControlOrMeta+Enter")
  await held.arrived
  await expect(manual).toBeDisabled()
  await expect(question.getByRole("button", { name: "Submit", exact: true })).toBeDisabled()
  await expect(question.getByRole("button", { name: "Dismiss", exact: true })).toBeDisabled()
  expect(held.requests).toHaveLength(1)
  held.release()
  expect((await failed).status()).toBe(500)
  await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
  await expect(question.getByRole("button", { name: "Submit", exact: true })).toBeEnabled()
  expect(replies).toEqual([{ answer }])
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(otherID)}"]`).click()
  await expectSessionTitle(page, "Other question session")
  await expect(question).toBeHidden()
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(sessionID)}"]`).click()
  await expectSessionTitle(page, title)
  await expect(manual).toHaveAttribute("aria-checked", "true")
  await expect(question.getByText("3 of 3 questions", { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(manual).toHaveAttribute("aria-checked", "true")
  await expect.poll(() => question.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("question-mobile.png") })
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/form/${form.id}/reply`),
  )
  await question.getByRole("button", { name: "Submit", exact: true }).click()
  expect((await accepted).status()).toBe(204)
  expect(replies).toEqual([{ answer }, { answer }])
  await workspace.push([
    {
      id: "evt_question_replied",
      created: 1700000001000,
      type: "form.replied",
      location: { directory },
      data: { sessionID, id: form.id, answer },
    },
  ])
  await expect(question).toBeHidden()
  await expect(page.locator('[data-component="composer"]')).toBeVisible()
  expect(errors).toEqual([])
})

for (const decision of [
  { label: "Allow once", value: "once" },
  { label: "Allow always", value: "always" },
  { label: "Deny", value: "reject" },
] as const) {
  test(`a pending permission dock sends ${decision.value} and disables its actions while sending`, async ({ page }) => {
    const replies: { sessionID: string; permissionID: string; body: unknown }[] = []
    await mockServer(page, {
      onPermissionReply: (reply) => replies.push(reply),
      sessionPermissions: {
        [sessionID]: [
          {
            id: "permission-request",
            sessionID,
            permission: "shell",
            patterns: ["git status", "git diff"],
            metadata: {},
            always: [],
          },
        ],
      },
    })

    const held = await holdRoute(page, (url) => url.pathname.endsWith("/permission/permission-request/reply"), {
      method: "POST",
    })
    await page.goto(sessionHref(sessionID))
    await expectSessionTitle(page, title)

    const permission = page.locator('[data-component="dock-prompt"][data-kind="permission"]')
    await expect(permission).toBeVisible()
    await expect(permission.getByText("git status")).toBeVisible()
    await expect(permission.getByText("git diff")).toBeVisible()
    await expect(permission.locator('[data-slot="permission-footer-actions"] button')).toHaveCount(3)
    await expect(page.locator('[data-component="composer"]')).toHaveCount(0)

    const reply = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/session/${sessionID}/permission/permission-request/reply`,
    )
    await permission.getByRole("button", { name: decision.label }).click()
    await held.arrived
    for (const label of ["Deny", "Allow always", "Allow once"])
      await expect(permission.getByRole("button", { name: label, exact: true })).toBeDisabled()
    expect(held.requests).toHaveLength(1)
    held.release()
    const response = await reply
    expect(new URL(response.url()).pathname).toBe(`/api/session/${sessionID}/permission/permission-request/reply`)
    expect(response.request().postDataJSON()).toEqual({ decision: decision.value })
    expect(response.status()).toBe(204)
    expect(replies).toEqual([{ sessionID, permissionID: "permission-request", body: { decision: decision.value } }])
    await expect(permission).toHaveCount(0)
    await expect(page.locator('[data-component="composer"]')).toBeVisible()
  })
}

test("restores the draft caret before typing after a request dock closes", async ({ page }) => {
  const transport = await installSseTransport(page, { server: SERVER, retry: 20 })
  await mockServer(page, { forms: [] })
  await page.goto(sessionHref(sessionID))
  await transport.waitForConnection()
  await expectSessionTitle(page, title)

  const editor = page.locator('[data-component="composer-editor"][contenteditable="true"]')
  const draft = "keep the caret at the end"

  const caret = () =>
    editor.evaluate((element) => {
      const selection = window.getSelection()

      if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return -1
      const range = selection.getRangeAt(0).cloneRange()
      range.selectNodeContents(element)
      range.setEnd(selection.anchorNode!, selection.anchorOffset)

      return range.toString().length
    })

  await editor.fill(draft)
  // The editor places the caret after the filled text; move it only from that known position.
  await expect.poll(caret).toBe(draft.length)

  for (let index = 0; index < 4; index++) await page.keyboard.press("ArrowLeft")
  const cursor = draft.length - 4
  await expect.poll(caret).toBe(cursor)
  await transport.send({
    id: "evt_form_created",
    created: 1700000001000,
    type: "form.created",
    location: { directory },
    data: {
      form: {
        id: "frm_question_caret",
        sessionID,
        title: "Questions",
        metadata: { kind: "question", tool: { messageID: "message-caret", id: "call-caret" } },
        fields: [
          {
            key: "q0",
            type: "string",
            title: "Continue",
            description: "Continue?",
            options: [{ value: "yes", label: "Yes", description: "Continue the session" }],
            custom: true,
          },
        ],
      },
    },
  })
  const question = page.locator('[data-component="dock-prompt"][data-kind="question"]')
  await expect(question).toBeVisible()
  await expect(editor).toHaveCount(0)

  await transport.send({
    id: "evt_form_cancelled",
    created: 1700000002000,
    type: "form.cancelled",
    location: { directory },
    data: { sessionID, id: "frm_question_caret" },
  })
  await expect(question).toHaveCount(0)
  await expect(editor).toBeVisible()
  await page.keyboard.press("x")

  await expect(editor).toHaveText(`${draft.slice(0, cursor)}x${draft.slice(cursor)}`)
})

test("Vault masks and clears a failed value, keeps server errors private and accepts a fresh retry", async ({
  page,
}) => {
  const form = vaultRequestForm(sessionID)
  const forms = [form]
  const replies: unknown[] = []
  const value = "fixture-only-private-value"
  const workspace = await mockServer(page, {
    forms: () => forms,
    onFormReply: (input) => {
      replies.push(input.body)
      if (replies.length === 1) return { status: 500, body: { message: value } }
      forms.splice(0)
    },
  })
  const held = await holdRoute(page, (url) => url.pathname.endsWith(`/form/${form.id}/reply`), { method: "POST" })
  await page.goto(sessionHref(sessionID))
  const dock = page.locator('[data-component="session-vault-dock"]')
  const input = dock.getByLabel("Value for example-token", { exact: true })
  await expect(input).toBeFocused({ timeout: APP_READY_TIMEOUT })
  await expect(input).toHaveAttribute("type", "password")
  await expect(input).toHaveAttribute("autocomplete", "off")
  await input.fill(value)
  await expect(page.getByRole("main")).not.toContainText(value)
  await dock.getByRole("button", { name: "Store", exact: true }).click()
  await held.arrived
  await expect(input).toHaveValue("")
  await expect(input).toBeDisabled()
  await expect(dock.getByRole("button", { name: "Store", exact: true })).toBeDisabled()
  await expect(dock.getByRole("button", { name: "Decline", exact: true })).toBeDisabled()
  held.release()
  await expect(page.getByText("Could not reach the vault. Please try again.", { exact: true })).toBeVisible()
  await expect(page.locator("body")).not.toContainText(value)
  await expect(input).toBeEnabled()
  await expect(input).toHaveValue("")
  await input.fill("fixture-retry-value")
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/form/${form.id}/reply`),
  )
  await dock.getByRole("button", { name: "Store", exact: true }).click()
  expect((await accepted).status()).toBe(204)
  expect(replies).toEqual([{ answer: { value } }, { answer: { value: "fixture-retry-value" } }])
  await workspace.push([
    {
      id: "evt_vault_replied",
      created: 1700000001000,
      type: "form.replied",
      location: { directory },
      data: { sessionID, id: form.id, answer: {} },
    },
  ])
  await expect(dock).toBeHidden()
  await expect(page.locator('[data-component="composer"]')).toBeVisible()
})

for (const action of ["button", "Escape"] as const) {
  test(`Vault clears and declines its masked value through ${action}`, async ({ page }) => {
    const form = vaultRequestForm(sessionID)
    const forms = [form]
    const workspace = await mockServer(page, { forms: () => forms })
    const held = await holdRoute(page, (url) => url.pathname.endsWith(`/form/${form.id}`), { method: "DELETE" })
    await page.goto(sessionHref(sessionID))
    const dock = page.locator('[data-component="session-vault-dock"]')
    const input = dock.getByLabel("Value for example-token", { exact: true })
    await expect(input).toBeFocused({ timeout: APP_READY_TIMEOUT })
    await input.fill("fixture-declined-value")
    const cancelled = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" && new URL(response.url()).pathname.endsWith(`/form/${form.id}`),
    )
    if (action === "Escape") await input.press("Escape")
    if (action === "button") await dock.getByRole("button", { name: "Decline", exact: true }).click()
    await held.arrived
    await expect(input).toHaveValue("")
    await expect(input).toBeDisabled()
    expect(held.requests).toHaveLength(1)
    expect(held.requests[0]?.postData()).toBeNull()
    held.release()
    expect((await cancelled).status()).toBe(204)
    forms.splice(0)
    await workspace.push([
      {
        id: "evt_vault_cancelled",
        created: 1700000001000,
        type: "form.cancelled",
        location: { directory },
        data: { sessionID, id: form.id },
      },
    ])
    await expect(dock).toBeHidden()
  })
}

test("specific web-search selection survives a failed reply and submits the selected provider", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const form = webSearchRequestForm(sessionID)
  const forms = [form]
  const replies: unknown[] = []
  const workspace = await mockServer(page, {
    forms: () => forms,
    onFormReply: (input) => {
      replies.push(input.body)
      if (replies.length === 1) return { status: 500, body: { message: "Fixture reply failed" } }
      forms.splice(0)
    },
  })
  const held = await holdRoute(page, (url) => url.pathname.endsWith(`/form/${form.id}/reply`), { method: "POST" })
  await page.goto(sessionHref(sessionID))
  const dock = page.getByRole("region", { name: "Third-party web search", exact: true })
  const select = dock.getByRole("combobox", { name: "Search provider", exact: true })
  await expect(select).toHaveValue("alpha", { timeout: APP_READY_TIMEOUT })
  await expect(select).toBeInViewport({ ratio: 1 })
  await select.selectOption("beta")
  await expect(dock.getByRole("button", { name: "Don’t use search", exact: true })).toHaveCount(0)
  await dock.getByRole("button", { name: "Enable", exact: true }).click()
  await held.arrived
  await expect(select).toBeDisabled()
  await expect(dock.getByRole("button", { name: "Enable", exact: true })).toBeDisabled()
  held.release()
  await expect(dock.getByText("Could not save your choice. Please try again.", { exact: true })).toBeVisible()
  await expect(select).toHaveValue("beta")
  await expect.poll(() => dock.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/form/${form.id}/reply`),
  )
  await dock.getByRole("button", { name: "Enable", exact: true }).click()
  expect((await accepted).status()).toBe(204)
  expect(replies).toEqual([{ answer: { provider: "beta" } }, { answer: { provider: "beta" } }])
  await workspace.push([
    {
      id: "evt_search_replied",
      created: 1700000001000,
      type: "form.replied",
      location: { directory },
      data: { sessionID, id: form.id, answer: { provider: "beta" } },
    },
  ])
  await expect(dock).toBeHidden()
})

test("web-search provider loading retries and permits declining an empty catalog", async ({ page }) => {
  const form = webSearchRequestForm(sessionID, false)
  const forms = [form]
  const reads = { count: 0 }
  const workspace = await mockServer(page, {
    forms: () => forms,
    onWebsearchProviders: () => {
      reads.count += 1
      if (reads.count === 1) return { status: 500, body: { message: "Fixture catalog unavailable" } }
    },
  })
  await page.goto(sessionHref(sessionID))
  const dock = page.getByRole("region", { name: "Third-party web search", exact: true })
  await expect(dock.getByText("Could not load search providers.", { exact: true })).toBeVisible({
    timeout: APP_READY_TIMEOUT,
  })
  await expect(dock.getByRole("combobox", { name: "Search provider", exact: true })).toBeDisabled()
  await dock.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(dock.getByText("No search providers available.", { exact: true })).toBeVisible()
  await expect(dock.getByRole("button", { name: "Enable", exact: true })).toBeDisabled()
  const declined = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/form/${form.id}/reply`),
  )
  await dock.getByRole("button", { name: "Don’t use search", exact: true }).click()
  const response = await declined
  expect(response.status()).toBe(204)
  expect(response.request().postDataJSON()).toEqual({ answer: { choice: "disable" } })
  expect(reads.count).toBe(2)
  forms.splice(0)
  await workspace.push([
    {
      id: "evt_search_disabled",
      created: 1700000001000,
      type: "form.replied",
      location: { directory },
      data: { sessionID, id: form.id, answer: { choice: "disable" } },
    },
  ])
  await expect(dock).toBeHidden()
})

function mockServer(
  page: Page,
  requests: Pick<
    WorkspaceInput,
    "sessionPermissions" | "onPermissionReply" | "forms" | "onFormReply" | "onWebsearchProviders" | "sessions"
  >,
) {
  return mockWorkspace(page, { name: "RequestDocks", directory, sessions: [{ id: sessionID, title }], ...requests })
}
