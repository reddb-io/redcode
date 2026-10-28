import { expect, test } from "@playwright/test"
import { provider } from "../utils/app"
import { openSettings } from "../utils/workspace"

test.use({ serviceWorkers: "block" })

test("chooses a discovered System One model for the selected connection", async ({ page }) => {
  const connection = { transport: "openrouter" as const, baseURL: "https://openrouter.example/v1", credentialID: "cred_selected" }
  const { settings } = await openSettings(page, {
    name: "Reasoning models",
    provider: provider(),
    intelligence: {
      settings: { enabled: true, onboarding: "completed", reasoning: "dual", principal: { providerID: "opencode", id: "test" } },
      environment: "",
      effective: { reasoning: "dual", source: "config" },
      evaluators: [{ name: "Chosen connection", configured: false, evaluator: connection }],
    },
  })
  const discovered: unknown[] = []
  const saved: unknown[] = []
  await page.route("**/api/experimental/intelligence/models", async (route) => {
    discovered.push(route.request().postDataJSON())
    await route.fulfill({ json: { models: [{ id: "typesafe/jev-1.13", name: "JEV 1.13" }, { id: "typesafe/jev-1.14", name: "JEV 1.14" }], manual: false } })
  })
  await page.route("**/api/experimental/generate**", (route) => route.fulfill({ json: { data: { text: "OK" } } }))
  await page.route("**/api/experimental/intelligence/probe", (route) => route.fulfill({ json: { ok: true, message: "OK", endpoint: "decisions", requests: [] } }))
  await page.route("**/api/experimental/intelligence", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback()
    saved.push(route.request().postDataJSON())
    await route.fulfill({ json: (route.request().postDataJSON() as { settings: unknown }).settings })
  })
  await settings.getByRole("tab", { name: "Models", exact: true }).click()
  const evaluator = settings.locator('[data-action="settings-reasoning-evaluator"]')
  await expect(evaluator).toHaveValue("")
  expect(discovered).toHaveLength(0)
  await evaluator.selectOption({ label: "Chosen connection" })
  await expect.poll(() => discovered.length).toBe(1)
  expect(discovered[0]).toEqual({ evaluator: connection })
  const model = settings.getByRole("combobox", { name: "System One model", exact: true })
  await expect(model).toHaveValue("")
  await model.selectOption("typesafe/jev-1.14")
  await settings.getByRole("button", { name: "Test and save", exact: true }).click()
  await expect.poll(() => saved.length).toBe(1)
  expect(saved[0]).toMatchObject({ settings: { evaluator: { ...connection, model: "typesafe/jev-1.14", endpoint: "decisions" } } })
})

test("keeps the saved evaluator without discovering or changing it on opening settings", async ({ page }) => {
  const chosen = { transport: "openrouter" as const, baseURL: "https://openrouter.example/v1", model: "typesafe/jev-1.13", credentialID: "cred_existing" }
  const { settings } = await openSettings(page, {
    name: "Saved reasoning model",
    provider: provider(),
    intelligence: {
      settings: { enabled: true, onboarding: "completed", reasoning: "dual", principal: { providerID: "opencode", id: "test" }, evaluator: chosen },
      environment: "",
      effective: { reasoning: "dual", source: "config" },
      evaluators: [{ name: "Existing connection", configured: true, evaluator: chosen }],
    },
  })
  const discoveries: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/experimental/intelligence/models") discoveries.push(request.url())
  })
  await settings.getByRole("tab", { name: "Models", exact: true }).click()
  await expect(settings.getByRole("combobox", { name: "System One model", exact: true })).toHaveValue("typesafe/jev-1.13")
  expect(discoveries).toEqual([])
})
