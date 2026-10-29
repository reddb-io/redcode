import { createServer, type Server } from "node:http"
import { expect, test } from "@playwright/test"
import { OauthCallbackPage } from "../../../core/src/oauth/page"

let server: Server
let origin: string

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    if (url.pathname === "/token") {
      response.writeHead(url.searchParams.has("fail") ? 400 : 200).end("Token exchange failed")
      return
    }
    response.setHeader("content-type", "text/html; charset=utf-8")
    if (url.pathname === "/success") return response.end(OauthCallbackPage.success({ provider: "ChatGPT", autoClose: false }))
    if (url.pathname === "/error") return response.end(OauthCallbackPage.error("Could not complete authorization", { provider: "ChatGPT" }))
    return response.end(OauthCallbackPage.bootstrap({ provider: "ChatGPT", tokenPath: url.searchParams.has("fail") ? "/token?fail" : "/token" }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Callback server did not listen")
  origin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

for (const scheme of ["light", "dark"] as const) {
  test(`renders the callback with the Design System in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.setViewportSize({ width: 390, height: 700 })
    await page.goto(`${origin}/success`)
    await expect(page.getByRole("heading", { name: "Authorization successful" })).toBeVisible()
    await expect(page.getByText("Redcode is now connected to ChatGPT.")).toBeVisible()
    await expect(page.locator('[data-status="success"] .art-success svg')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const colors = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(document.body).color,
    }))
    expect(colors.background).toBe(scheme === "dark" ? "rgb(7, 8, 10)" : "rgb(244, 245, 247)")
    expect(colors.foreground).not.toBe(colors.background)
  })
}

test("reports errors and resolves the fragment callback in place", async ({ page }) => {
  await page.goto(`${origin}/error`)
  await expect(page.getByRole("heading", { name: "Authorization failed" })).toBeVisible()
  await expect(page.getByText("Could not complete authorization")).toBeVisible()
  await expect(page.locator('[data-status="error"] .art-error svg')).toBeVisible()
  await page.goto(`${origin}/bootstrap#access_token=fixture&state=fixture`)
  await expect(page.getByRole("heading", { name: "Authorization successful" })).toBeVisible()
  await expect(page.locator('[data-status="success"] .art-success svg')).toBeVisible()
  await page.goto(`${origin}/bootstrap?fail#access_token=fixture&state=fixture`)
  await expect(page.getByRole("heading", { name: "Authorization failed" })).toBeVisible()
  await expect(page.getByText("Token exchange failed")).toBeVisible()
  await expect(page.locator('[data-status="error"] .art-error svg')).toBeVisible()
})
