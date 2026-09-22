import { expect, test } from "bun:test"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"

test("global intelligence setup is available through the CLI server composition", async () => {
  const server = HttpRouter.toWebHandler(HttpApiApp.createRoutes(), { disableLogger: true })
  const request = (method: string, body?: unknown) =>
    server.handler(
      new Request("http://localhost/api/intelligence", {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      HttpApiApp.context,
    )
  try {
    const initial = await request("GET")
    expect(initial.status).toBe(200)
    const probe = await server.handler(
      new Request("http://localhost/api/intelligence/test-model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerID: "missing-provider", id: "missing-model" }),
      }),
      HttpApiApp.context,
    )
    expect(probe.status).toBe(200)
    expect((await probe.json()).ok).toBe(false)
    const before = await initial.json()
    expect(
      before.evaluators.some(
        (option: { evaluator: { transport: string } }) => option.evaluator.transport === "opencode-zen",
      ),
    ).toBe(true)
    try {
      const saved = await request("PUT", { settings: { enabled: false, onboarding: "deferred" } })
      expect(saved.status).toBe(200)
      const after = await (await request("GET")).json()
      expect(after.settings).toEqual({ enabled: false, onboarding: "deferred" })
      expect(after.effective).toEqual({ reasoning: "single", source: "default" })
      const invalid = await request("PUT", { settings: { enabled: true, onboarding: "completed" } })
      expect(invalid.status).toBe(400)
    } finally {
      await request("PUT", { settings: before.settings })
    }
  } finally {
    await server.dispose()
  }
})
