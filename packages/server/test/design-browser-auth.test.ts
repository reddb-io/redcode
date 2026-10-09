import { expect } from "bun:test"
import { Design } from "@opencode/schema/design"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect, Option, Schema } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { DesignAccess } from "../src/design-access"
import { ServerAuth } from "../src/auth"
import { startServer } from "./fixture/server"

it.live("Design entry creates a new session in a loaded project and keeps session-scoped tasks separate", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
    const server = yield* startServer(directory.path)
    const headers = { ...server.headers, "content-type": "application/json" }
    const request = (pathname: string, input?: unknown, authenticated = true) =>
      Effect.promise(() =>
        fetch(new URL(pathname, server.base), {
          headers: authenticated ? headers : { "content-type": "application/json" },
          method: input === undefined ? "GET" : "POST",
          body: input === undefined ? undefined : JSON.stringify(input),
        }),
      )
    const anonymous = yield* request("/design", undefined, false)
    expect(anonymous.status).toBe(200)
    expect(anonymous.headers.get("www-authenticate")).toBeNull()
    expect(yield* Effect.promise(() => anonymous.text())).toContain("redcode pair")
    const refused = yield* request("/design/new", { source: "ses_entry_source" }, false)
    expect(refused.status).toBe(401)
    yield* Effect.promise(() => refused.arrayBuffer())
    const source = yield* request("/api/session", {
      id: "ses_entry_source",
      title: "Profile project",
      location: { directory: directory.path },
    })
    expect(source.status).toBe(200)
    yield* Effect.promise(() => source.arrayBuffer())
    const entry = yield* request("/design")
    expect(entry.status).toBe(200)
    expect(yield* Effect.promise(() => entry.text())).toContain("Profile project")
    const launched = yield* request("/design/new", { source: "ses_entry_source" })
    expect(launched.status).toBe(200)
    const result = yield* Effect.promise(() => launched.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ sessionID: Schema.String, url: Schema.String }))),
    )
    expect(result.sessionID).not.toBe("ses_entry_source")
    expect(new URL(result.url).port).toBe(new URL(server.base).port)
    const session = yield* request(`/api/session/${result.sessionID}`)
    expect(yield* Effect.promise(() => session.json())).toMatchObject({
      data: { agent: "design", location: { directory: directory.path } },
    })
    // Only a credentialed browser creates sessions here, so it gets the stable review without a ticket.
    expect(new URL(result.url).search).toBe("")
    const stable = yield* Effect.promise(() => fetch(result.url, { headers: server.headers }))
    expect(stable.status).toBe(200)
    expect(stable.headers.get("set-cookie")).toBeNull()
    yield* Effect.promise(() => stable.arrayBuffer())
    const link = yield* request(`/design/session/${result.sessionID}/link`)
    const signed = yield* Effect.promise(() => link.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ url: Schema.String }))),
    )
    const review = yield* Effect.promise(() => fetch(signed.url))
    expect(review.status).toBe(200)
    expect(review.redirected).toBe(false)
    const cookie = (review.headers.get("set-cookie") ?? "").split(";")[0]
    yield* Effect.promise(() => review.arrayBuffer())
    const todos = yield* Effect.promise(() =>
      fetch(new URL(`/design/session/${result.sessionID}/todo`, server.base), { headers: { cookie } }),
    )
    expect({ status: todos.status, body: yield* Effect.promise(() => todos.json()) }).toEqual({ status: 200, body: [] })
    const share = yield* Effect.promise(() =>
      fetch(new URL(`/design/session/${result.sessionID}/share`, server.base), { headers: { cookie } }),
    )
    expect(yield* Effect.promise(() => share.json())).toEqual({})
    const wrong = yield* Effect.promise(() =>
      fetch(new URL("/design/session/ses_entry_source/todo", server.base), { headers: { cookie } }),
    )
    expect(wrong.status).toBe(401)
    yield* Effect.promise(() => wrong.arrayBuffer())
  }),
)

it.live("LAN review links stay on the owning server and grant annotations without general credentials", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
    const server = yield* startServer(directory.path, "0.0.0.0")
    const headers = { ...server.headers, "content-type": "application/json" }
    const created = yield* Effect.promise(() =>
      fetch(new URL("/api/session", server.base), {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "ses_lan_design", agent: "design", location: { directory: directory.path } }),
      }),
    )
    expect(created.status).toBe(200)
    yield* Effect.promise(() => created.arrayBuffer())
    const link = yield* Effect.promise(() =>
      fetch(new URL("/design/session/ses_lan_design/link", server.base), { headers }),
    )
    const links = yield* Effect.promise(() => link.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ url: Schema.String, network: Schema.String }))),
    )
    expect(new URL(links.network).port).toBe(new URL(server.base).port)
    expect(new URL(links.network).hostname).not.toBe("127.0.0.1")
    // Reach the LAN grant through loopback too: the grant is for this Session, not a server password.
    const local = new URL(links.network)
    local.hostname = "127.0.0.1"
    const review = yield* Effect.promise(() => fetch(local, { redirect: "manual" }))
    expect(review.status).toBe(200)
    expect(review.headers.get("location")).toBeNull()
    expect(review.headers.get("www-authenticate")).toBeNull()
    yield* Effect.promise(() => review.arrayBuffer())
  }),
)

it.live("approval into Plan retires preview routes while keeping the immutable approval readable", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
    const server = yield* startServer(directory.path)
    const sessionID = "ses_design_retired"
    const headers = { ...server.headers, "content-type": "application/json" }
    const request = (pathname: string, input?: unknown) =>
      Effect.promise(() =>
        fetch(new URL(pathname, server.base), {
          headers,
          method: input === undefined ? "GET" : "POST",
          body: input === undefined ? undefined : JSON.stringify(input),
        }),
      )
    const created = yield* request("/api/session", {
      id: sessionID,
      agent: "design",
      location: { directory: directory.path },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    })
    expect(created.status).toBe(200)
    yield* Effect.promise(() => created.arrayBuffer())
    const designResponse = yield* request(`/design/session/${sessionID}`, {
      name: "Profile",
      journey: "new",
      engine: "html",
      kind: "screen",
    })
    const document = yield* Effect.promise(() => designResponse.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Design.Info)),
    )
    const published = yield* request(`/design/session/${sessionID}/${document.id}/revision`, { name: "Profile" })
    const revision = yield* Effect.promise(() => published.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Design.Revision)),
    )
    const imported = yield* request(`/design/session/${sessionID}/${document.id}/asset`, {
      name: "screenshot1.png",
      mime: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR4nGNgOMDwH4xhDAA6dAb9wA076gAAAABJRU5ErkJggg==",
      source: JSON.stringify({
        type: "design-approval-capture",
        revision: revision.id,
        reference: "$screenshot1",
        variant: "",
        screen: "profile",
        width: 800,
        height: 600,
        scrollX: 0,
        scrollY: 20,
      }),
    })
    expect(imported.status).toBe(200)
    const screenshot = yield* Effect.promise(() => imported.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Design.Asset)),
    )
    const approvalInput = { revision: revision.id, screenshot: screenshot.id }
    const approved = yield* request(`/design/session/${sessionID}/${document.id}/approve`, approvalInput)
    expect(approved.status).toBe(200)
    expect(yield* Effect.promise(() => approved.json())).toMatchObject({ agent: "plan", revision: revision.id })
    const retried = yield* request(`/design/session/${sessionID}/${document.id}/approve`, approvalInput)
    expect(retried.status).toBe(200)
    yield* Effect.promise(() => retried.arrayBuffer())
    // Execution may have delivered the input: read pending before visible so either durable state is covered.
    const pendingResponse = yield* request(`/api/session/${sessionID}/inbox`)
    const pending = yield* Effect.promise(() => pendingResponse.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Array(SessionInbox.Info) }))),
    )
    const visibleResponse = yield* request(`/api/session/${sessionID}/message`)
    const visible = yield* Effect.promise(() => visibleResponse.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Array(SessionMessage.Info) }))),
    )
    const images = [
      ...pending.data.flatMap((item) => (item.type === "user" ? [{ id: item.id, ...item.payload }] : [])),
      ...visible.data.filter((message) => message.type === "user"),
    ].filter((message) => message.metadata?.source === "design.approval.reference")
    expect(new Set(images.map((message) => message.id)).size).toBe(1)
    expect(images[0]?.text).toContain("$screenshot1 = image 1: screenshot1.png")
    expect(images[0]?.files?.[0]).toMatchObject({ mime: "image/png", name: "screenshot1.png" })
    yield* Effect.forEach(
      ["link", "review", "feed", `${document.id}/present`, `${document.id}/revision/${revision.id}/preview`],
      (route) =>
        Effect.gen(function* () {
          const response = yield* request(`/design/session/${sessionID}/${route}`)
          expect(response.status).toBe(410)
          expect(response.headers.get("www-authenticate")).toBeNull()
          yield* Effect.promise(() => response.arrayBuffer())
        }),
    )
    const launch = yield* request(`/design/session/${sessionID}/launch`, { explicit: true })
    expect(launch.status).toBe(410)
    yield* Effect.promise(() => launch.arrayBuffer())
    const record = yield* request(`/design/session/${sessionID}/${document.id}/approval/${revision.id}`)
    expect(record.status).toBe(200)
    expect(yield* Effect.promise(() => record.json())).toMatchObject({
      revision: { id: revision.id },
      screenshot: { id: screenshot.id, hash: screenshot.hash },
    })
    const other = yield* request("/api/session", {
      id: "ses_design_other",
      agent: "design",
      location: { directory: directory.path },
    })
    yield* Effect.promise(() => other.arrayBuffer())
    const otherLink = yield* request("/design/session/ses_design_other/link")
    expect(otherLink.status).toBe(200)
    yield* Effect.promise(() => otherLink.arrayBuffer())
  }),
)

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
          // A person opened this page: it explains how to get back in instead of answering JSON.
          expect(denied.headers.get("content-type")).toStartWith("text/html")
          const text = yield* Effect.promise(() => denied.text())
          expect(text).toContain(`redcode design ${sessionID}`)
          expect(text).toContain("redcode pair")
          expect(text).toContain(`href=\\"/design/session/${sessionID}/review\\"`)
          expect(text).not.toContain("ticket=")
        }),
    )
    // API calls of an open page keep JSON errors; the page shows them as a banner.
    const feedDenied = yield* request(`/design/session/${sessionID}/feed`)
    expect(feedDenied.status).toBe(401)
    expect(feedDenied.headers.get("content-type")).toStartWith("application/json")
    yield* Effect.promise(() => feedDenied.arrayBuffer())

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

it.live("a stable review link opens for a paired browser, and an open review's cookie slides forward", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
    const server = yield* startServer(directory.path)
    const sessionID = "ses_design_stable"
    const created = yield* Effect.promise(() =>
      fetch(new URL("/api/session", server.base), {
        method: "POST",
        headers: { ...server.headers, "content-type": "application/json" },
        body: JSON.stringify({ id: sessionID, agent: "design", location: { directory: directory.path } }),
      }),
    )
    expect(created.status).toBe(200)
    yield* Effect.promise(() => created.arrayBuffer())
    const review = new URL(`/design/session/${sessionID}/review`, server.base)
    const get = (url: URL, cookie: string) =>
      Effect.promise(() => fetch(url, { headers: { cookie, "sec-fetch-mode": "navigate" }, redirect: "manual" }))

    // A browser paired with `redcode pair` holds the server's session cookie and needs no ticket.
    const paired = `${ServerAuth.sessionCookieName(review.host)}=${ServerAuth.issueSession({ password: Option.some("secret"), username: "opencode" })}`
    const opened = yield* get(review, paired)
    expect(opened.status).toBe(200)
    expect(opened.headers.get("set-cookie")).toBeNull()
    yield* Effect.promise(() => opened.arrayBuffer())

    // A review cookie is issued again on the page and once it is due, so polling keeps an open page signed in.
    const fresh = `${DesignAccess.COOKIE}=${DesignAccess.ticket("secret", sessionID, DesignAccess.COOKIE_TTL)}`
    const due = `${DesignAccess.COOKIE}=${DesignAccess.ticket("secret", sessionID, DesignAccess.COOKIE_TTL, Date.now() - DesignAccess.COOKIE_RENEWAL - 60_000)}`
    const todo = new URL(`/design/session/${sessionID}/todo`, server.base)
    const quiet = yield* get(todo, fresh)
    expect(quiet.status).toBe(200)
    expect(quiet.headers.get("set-cookie")).toBeNull()
    yield* Effect.promise(() => quiet.arrayBuffer())
    yield* Effect.forEach([get(todo, due), get(review, fresh)], (response) =>
      Effect.gen(function* () {
        const renewed = yield* response
        expect(renewed.status).toBe(200)
        const cookie = renewed.headers.get("set-cookie") ?? ""
        expect(cookie).toStartWith(`${DesignAccess.COOKIE}=`)
        expect(cookie).toContain(`Path=/design/session/${sessionID}`)
        expect(cookie).toContain("HttpOnly")
        const value = cookie.split(";")[0]!.slice(DesignAccess.COOKIE.length + 1)
        expect(DesignAccess.renewal(value)).toBe(false)
        yield* Effect.promise(() => renewed.arrayBuffer())
      }),
    )
  }),
)
