import { afterAll, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { defectLayer } from "../src/middleware/defect"

const web = HttpRouter.toWebHandler(
  Layer.mergeAll(
    HttpRouter.add("GET", "/defect", Effect.die(new Error("database is locked\nsecond line"))),
    HttpRouter.add("GET", "/ok", HttpServerResponse.text("ok")),
    defectLayer("test"),
  ),
  { disableLogger: true },
)

afterAll(() => web.dispose())

test("answers an unhandled defect with a 500 naming a ref and the log file", async () => {
  const response = await web.handler(new Request("http://localhost/defect"))
  expect(response.status).toBe(500)
  const body = await response.json()
  expect(body._tag).toBe("UnknownError")
  expect(body.ref).toMatch(/^err_[0-9a-f]{8}$/)
  expect(body.log).toEndWith("opencode.log")
  expect(body.message).toContain("database is locked")
  expect(body.message).toContain(body.ref)
  // The first line is the diagnosis; the rest (and any stack) stays in the log.
  expect(body.message).not.toContain("second line")
})

test("leaves successful routes and missing routes alone", async () => {
  expect(await (await web.handler(new Request("http://localhost/ok"))).text()).toBe("ok")
  expect((await web.handler(new Request("http://localhost/missing"))).status).toBe(404)
})
