import { expect, test } from "@playwright/test"
import type { ProviderCatalog } from "@opencode/client/promise"
import { openDraft, openSettings } from "../utils/workspace"

test("ChatGPT sign-in waits for discovery and can recover a catalog error without signing in again", async ({
  page,
}) => {
  const state = { signedIn: false, recovered: false, attempts: 0, refreshes: 0 }
  const catalog: { current: ProviderCatalog } = { current: { status: "loading" } }
  const connections: { type: "credential"; id: string; label: string; method: "oauth" }[] = []
  const { settings, directory } = await openSettings(page, {
    name: "ChatGPT sign in",
    provider: () => ({
      all: [
        {
          id: "openai",
          name: "OpenAI",
          catalog: state.signedIn ? catalog.current : undefined,
          models: state.recovered
            ? {
                discovered: { id: "discovered", name: "Account model after recovery", cost: { input: 0, output: 0 } },
              }
            : {},
        },
      ],
      connected: state.signedIn ? ["openai"] : [],
      default: {},
    }),
    integrations: [
      {
        id: "openai",
        name: "OpenAI",
        methods: [{ type: "oauth", id: "chatgpt-token-sharing", label: "Sign in with ChatGPT" }],
        connections,
      },
    ],
  })
  await page
    .context()
    .route("https://auth.example.test/**", (route) => route.fulfill({ body: "Fixture authorization" }))
  await page.route("**/api/integration/openai/connect/oauth**", async (route) => {
    const time = { created: Date.now(), expires: Date.now() + 600_000 }
    if (route.request().method() === "POST") {
      state.attempts++
      return route.fulfill({
        json: {
          location: { directory },
          data: {
            attemptID: "con_chatgpt",
            url: "https://auth.example.test/authorize",
            instructions: "",
            mode: "auto",
            time,
          },
        },
      })
    }
    state.signedIn = true
    if (!connections.length)
      connections.push({ type: "credential", id: "cred_chatgpt", label: "My ChatGPT account", method: "oauth" })
    return route.fulfill({ json: { location: { directory }, data: { status: "complete", time } } })
  })
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route("**/api/provider/openai/refresh**", async (route) => {
    state.refreshes++
    if (state.refreshes === 1) {
      started.resolve()
      await release.promise
      catalog.current = {
        status: "error",
        httpStatus: 403,
        requestID: "req_signin",
        message: "This workspace does not allow ChatGPT plan usage.",
      }
      return route.fulfill({ status: 400, json: { message: catalog.current.message } })
    }
    state.recovered = true
    catalog.current = { status: "ready", updatedAt: Date.now() }
    return route.fulfill({ json: { location: { directory } } })
  })
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  await settings.getByRole("button", { name: "Show more providers", exact: true }).click()
  const picker = page.getByRole("dialog", { name: "Connect provider", exact: true })
  await picker.getByRole("searchbox", { name: "Search providers", exact: true }).fill("OpenAI")
  await picker.getByRole("button", { name: /OpenAI/ }).click()
  await started.promise
  const connect = page.getByRole("dialog", { name: "Connect OpenAI", exact: true })
  await expect(connect).toBeVisible()
  await expect(page.locator('[data-component="first-provider-models"]')).toHaveCount(0)
  release.resolve()
  await expect(connect.getByText("Account connected", { exact: true })).toBeVisible()
  await expect(connect).toContainText("This workspace does not allow ChatGPT plan usage.")
  await expect(connect).toContainText("req_signin")
  await connect.getByRole("button", { name: "Update model list", exact: true }).click()
  await expect(page.locator('[data-component="first-provider-models"]')).toContainText("Account model after recovery")
  expect(state.attempts).toBe(1)
  expect(state.refreshes).toBe(2)
})

for (const scheme of ["light", "dark"] as const) {
  test(`account models show cache errors and update without reloading the Location (${scheme})`, async ({ page }) => {
    const state: { catalog: ProviderCatalog; name: string } = {
      catalog: {
        status: "stale",
        updatedAt: 1_790_000_000_000,
        httpStatus: 403,
        code: "subscription_sharing_user_not_eligible",
        requestID: "req_account_catalog",
        message: "This workspace does not allow ChatGPT plan usage.",
      },
      name: "Cached account model",
    }
    const { settings } = await openSettings(page, {
      name: "Account catalog",
      seed: { theme: { id: "oc-2", scheme } },
      provider: () => ({
        all: [
          {
            id: "openai",
            name: "OpenAI",
            catalog: state.catalog,
            models: {
              "account-model": { id: "account-model", name: state.name, cost: { input: 1, output: 0 } },
            },
          },
        ],
        connected: ["openai"],
        default: {},
      }),
      integrations: [
        {
          id: "openai",
          name: "OpenAI",
          methods: [{ type: "oauth", id: "chatgpt-token-sharing", label: "Sign in with ChatGPT" }],
          connections: [{ type: "credential", id: "cred_chatgpt", label: "My ChatGPT account", method: "oauth" }],
        },
      ],
    })
    const release = Promise.withResolvers<void>()
    const requests: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST") requests.push(new URL(request.url()).pathname)
    })
    await page.route("**/api/provider/openai/refresh**", async (route) => {
      await release.promise
      state.catalog = { status: "ready", updatedAt: Date.now() }
      state.name = "Updated account model"
      await route.fulfill({ json: { location: { directory: "C:/OpenCode/Account catalog" } } })
    })
    await settings.getByRole("tab", { name: "Providers", exact: true }).click()
    const connected = settings.locator('[data-component="connected-providers-section"]')
    await connected.getByRole("button", { name: "Manage OpenAI accounts", exact: true }).click()
    await page.getByRole("menuitem", { name: "Manage connections…", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "OpenAI connections", exact: true })
    const catalog = dialog.locator('[data-component="provider-model-catalog"]')
    await expect(catalog).toContainText("Using 1 cached model")
    await expect(catalog).toContainText(state.catalog.message!)
    await catalog.getByText("Error details", { exact: true }).click()
    await expect(catalog).toContainText("403")
    await expect(catalog).toContainText("subscription_sharing_user_not_eligible")
    await expect(catalog).toContainText("req_account_catalog")
    await page.screenshot({ path: `e2e/test-results/provider-catalog-error-${scheme}.png` })
    const refresh = catalog.getByRole("button", { name: "Update model list", exact: true })
    await refresh.click()
    await expect(refresh).toBeDisabled()
    release.resolve()
    await expect(catalog).toContainText("1 model available for this account.")
    await expect(catalog).not.toContainText("req_account_catalog")
    await expect(refresh).toBeEnabled()
    expect(requests.filter((path) => path === "/api/provider/openai/refresh")).toHaveLength(1)
    expect(requests.filter((path) => path.includes("location") && path.includes("reload"))).toHaveLength(0)
    await page.screenshot({ path: `e2e/test-results/provider-catalog-ready-${scheme}.png` })
  })
}

test("the model picker refreshes the selected account without rebuilding Location services", async ({ page }) => {
  const state = { updated: false }
  await openDraft(page, {
    name: "Account models picker",
    provider: () => ({
      all: [
        {
          id: "openai",
          name: "OpenAI",
          catalog: { status: "ready", updatedAt: Date.now() },
          models: {
            original: { id: "original", name: "Original account model", cost: { input: 1, output: 0 } },
            ...(state.updated
              ? { discovered: { id: "discovered", name: "Discovered account model", cost: { input: 1, output: 0 } } }
              : {}),
          },
        },
      ],
      connected: ["openai"],
      default: { providerID: "openai", modelID: "original" },
    }),
  })
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST") requests.push(new URL(request.url()).pathname)
  })
  await page.route("**/api/provider/openai/refresh**", async (route) => {
    state.updated = true
    await route.fulfill({ json: { location: { directory: "C:/OpenCode/Account models picker" } } })
  })
  await page.locator('[data-action="composer-model"]').click()
  const picker = page.getByRole("dialog", { name: "Select model", exact: true })
  await expect(picker.getByRole("menuitemradio", { name: /Original account model/ })).toBeVisible()
  await picker.getByRole("menuitem", { name: "Refresh models", exact: true }).click()
  await expect(page.getByText("Models refreshed", { exact: true })).toBeVisible()
  await expect(picker.getByRole("menuitemradio", { name: /Discovered account model/ })).toBeVisible()
  expect(requests).toContain("/api/provider/openai/refresh")
  expect(requests.filter((path) => path.includes("location") && path.includes("reload"))).toEqual([])
})
