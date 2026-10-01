import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { DesignAccess } from "../src/design-access"
import { startServer } from "./fixture/server"

it.live("signed Design pages exchange tickets for scoped cookies without a Basic credentials prompt", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
    const server = yield* startServer(directory.path)
    const headers = { ...server.headers, "content-type": "application/json" }
    const sessionID = "ses_design_auth"
    const request = (pathname: string, init?: RequestInit) =>
      Effect.promise(() => fetch(new URL(pathname, server.base), { redirect: "manual", ...init }))
    const created = yield* request("/api/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: sessionID, location: { directory: directory.path } }),
    })
    expect(created.status).toBe(200)
    yield* Effect.promise(() => created.arrayBuffer())
    const link = yield* request(`/design/session/${sessionID}/link`, { headers })
    expect(link.status).toBe(200)
    const review = (yield* Effect.promise(() => link.json())) as { url: string }
    const page = yield* Effect.promise(() => fetch(review.url, { headers: { "sec-fetch-mode": "navigate" } }))
    expect(page.status).toBe(200)
    expect(page.headers.get("www-authenticate")).toBeNull()
    const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0]
    expect(cookie).toStartWith(`${DesignAccess.COOKIE}=`)
    expect(page.headers.get("set-cookie")).toContain(`Path=/design/session/${sessionID}`)
    expect(yield* Effect.promise(() => page.text())).toContain("<!doctype html>")
    const reopened = yield* request(`/design/session/${sessionID}/review`, { headers: { cookie } })
    expect(reopened.status).toBe(200)
    yield* Effect.promise(() => reopened.arrayBuffer())

    yield* Effect.forEach(
      [
        `/design/session/${sessionID}/review`,
        `/design/session/${sessionID}/review?ticket=invalid`,
        `/design/session/${sessionID}/review?ticket=${DesignAccess.ticket("secret", "ses_other")}`,
        `/design/session/${sessionID}/review?ticket=${DesignAccess.ticket("secret", sessionID, -1)}`,
      ],
      (pathname) =>
        Effect.gen(function* () {
          const denied = yield* request(pathname, { headers: { "sec-fetch-mode": "navigate" } })
          expect(denied.status).toBe(401)
          expect(denied.headers.get("www-authenticate")).toBeNull()
          yield* Effect.promise(() => denied.arrayBuffer())
        }),
    )

    yield* Effect.forEach(
      [
        ["/api/info", "GET"],
        [`/design/session/${sessionID}/link`, "GET"],
        [`/design/session/${sessionID}/launch`, "POST"],
        [`/design/session/${sessionID}/permission`, "POST"],
      ],
      ([pathname, method]) =>
        Effect.gen(function* () {
          const denied = yield* request(pathname, { method, headers: { cookie } })
          expect(denied.status).toBe(401)
          yield* Effect.promise(() => denied.arrayBuffer())
        }),
    )
  }),
)
