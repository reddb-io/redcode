import type { Page } from "@playwright/test"

export async function mockConnectionEdits(page: Page, connections: { id: string; label: string }[]) {
  const updates: { id: string; label: string }[] = []
  const state = { checks: 0 }
  await page.route(
    (url) => /^\/api\/credential\/[^/]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback()
      const id = new URL(route.request().url()).pathname.split("/").pop()!
      const body = route.request().postDataJSON() as { label: string }
      const connection = connections.find((connection) => connection.id === id)
      if (!connection) return route.fulfill({ status: 404 })
      updates.push({ id, label: body.label })
      connection.label = body.label
      await route.fulfill({ status: 204 })
    },
  )
  await page.route(
    (url) => /^\/api\/integration\/[^/]+\/check$/.test(url.pathname),
    async (route) => {
      state.checks++
      const ok = state.checks > 1
      await route.fulfill({
        json: {
          ok,
          message: ok ? "Catalog verified" : "Temporary upstream failure",
          requests: [
            {
              url: "https://provider.example.test/models",
              method: "GET",
              status: ok ? 200 : 503,
              durationMs: 10,
              bytes: ok ? 42 : 0,
            },
          ],
        },
      })
    },
  )
  return { updates, state }
}
