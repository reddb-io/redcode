import { expect } from "bun:test"
import { Design } from "@opencode/schema/design"
import { Effect, Schema } from "effect"
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
      body: JSON.stringify({
        id: sessionID,
        location: { directory: directory.path },
        permissions: [{ action: "read", resource: "*", effect: "allow" }],
      }),
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

    // Exercise mutations through the browser's scoped cookie, not the trusted Basic-auth API.
    const browserHeaders = { cookie, "content-type": "application/json" }
    const documentResponse = yield* request(`/design/session/${sessionID}`, {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ name: "Variants", journey: "new", engine: "html", kind: "screen" }),
    })
    expect(documentResponse.status).toBe(200)
    const document = yield* Effect.promise(() => documentResponse.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Design.Info)),
    )
    yield* Effect.promise(() =>
      Bun.write(
        `${document.root}/${document.entry}`,
        '<main><section data-design-variant="compact">Compact</section><section data-design-variant="wide">Wide</section></main>',
      ),
    )
    const revisionResponse = yield* request(`/design/session/${sessionID}/${document.id}/revision`, {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ name: "Two variants" }),
    })
    expect(revisionResponse.status).toBe(200)
    const revision = yield* Effect.promise(() => revisionResponse.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Design.Revision)),
    )
    // Approval also resolves Session, execution and goals before validating its revision.
    const invalidApproval = yield* request(`/design/session/${sessionID}/${document.id}/approve`, {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ revision: "missing-revision" }),
    })
    expect({ status: invalidApproval.status, body: yield* Effect.promise(() => invalidApproval.json()) }).toMatchObject(
      {
        status: 409,
        body: { message: "Approve the currently published revision" },
      },
    )
    const feedback = {
      id: "msg_design_delete_variant",
      revision: revision.id,
      action: { kind: "delete", variants: ["compact"], labels: ["Compact"] },
      text: "",
      items: [],
      assets: [],
      snapshot: "",
      delivery: "queue",
      end: false,
    }
    yield* Effect.forEach([0, 1], () =>
      Effect.gen(function* () {
        const response = yield* request(`/design/session/${sessionID}/${document.id}/feedback`, {
          method: "POST",
          headers: browserHeaders,
          body: JSON.stringify(feedback),
        })
        expect(response.status).toBe(200)
        expect(yield* Effect.promise(() => response.json())).toEqual({ id: feedback.id, status: "admitted" })
      }),
    )
    const conflictingFeedback = yield* request(`/design/session/${sessionID}/${document.id}/feedback`, {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ ...feedback, action: { ...feedback.action, variants: ["wide"] } }),
    })
    expect(conflictingFeedback.status).toBe(409)
    yield* Effect.promise(() => conflictingFeedback.arrayBuffer())

    // The default server does not retain event payloads. Its projected conversation still reaches the browser.
    const entry = yield* Effect.promise(async () => {
      const response = await fetch(new URL(`/design/session/${sessionID}/feed`, server.base), {
        headers: { cookie },
        signal: AbortSignal.timeout(5_000),
      })
      expect(response.status).toBe(200)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      const state = { buffer: "" }
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) throw new Error("Design feed ended before replaying the saved feedback")
          state.buffer += decoder.decode(chunk.value, { stream: true })
          const blocks = state.buffer.split("\n\n")
          state.buffer = blocks.pop() ?? ""
          const found = blocks
            .flatMap((block) => block.split("\n"))
            .filter((line) => line.startsWith("data: "))
            .map((line) => Schema.decodeUnknownSync(Design.FeedEvent)(JSON.parse(line.slice(6))))
            .find((entry) => entry.type === "user" && entry.id === feedback.id)
          if (found) return found
        }
      } finally {
        await reader.cancel()
      }
    })
    expect(entry).toMatchObject({ type: "user", id: feedback.id, text: "Variant operation: delete Compact" })

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
