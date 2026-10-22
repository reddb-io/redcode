import type { Page } from "@playwright/test"
import { RemoteAccess } from "@opencode/schema/remote-access"
import { Schema } from "effect"
import { SERVER } from "./app"

export async function mockHttpsAccess(page: Page) {
  const operations: { method: string; relay?: string; acceptExposure?: boolean; code?: string }[] = []
  let state: RemoteAccess.Status = { available: true, state: "disabled" }
  let fail = true
  let pairs = 0
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "*",
  }
  await page.route(`${SERVER}/api/remote-access`, async (route) => {
    const method = route.request().method()
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers })
    if (method === "POST") {
      const input = Schema.decodeUnknownSync(RemoteAccess.Configure)(route.request().postDataJSON())
      operations.push({ method, ...input })
      state = fail
        ? { available: true, state: "failed", relay: input.relay }
        : { available: true, state: "provisioning", relay: input.relay }
      fail = false
    }
    if (method === "DELETE") {
      operations.push({ method })
      state = { available: true, state: "disabled" }
    }
    if (method === "GET" && state.state === "provisioning")
      state = { ...state, state: "ready", url: "https://device.secure.example.test" }
    return route.fulfill({ json: state, headers })
  })
  await page.route(`${SERVER}/api/pair`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers })
    operations.push({ method: "pair" })
    pairs++
    return route.fulfill({
      json: { code: pairs === 1 ? "https-one-time-code" : `https-one-time-code-${pairs}`, expires_in: 300 },
      headers,
    })
  })
  await page.route(`${SERVER}/api/pair/*`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers })
    operations.push({ method: "cancel", code: new URL(route.request().url()).pathname.split("/").pop() })
    return route.fulfill({ status: 204, headers })
  })
  return { operations }
}
