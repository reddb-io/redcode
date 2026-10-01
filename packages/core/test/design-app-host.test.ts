import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { realpath, stat } from "node:fs/promises"
import { Schema } from "effect"
import { Design } from "@opencode/schema/design"
import { Session } from "@opencode/schema/session"
import { DesignApp } from "@opencode/core/design/app"
import { DesignAppHost } from "@opencode/core/design/app-host"
import { DesignAppMode } from "@opencode/core/design/app-mode"
import { DesignHost } from "@opencode/core/design/host"
import { tmpdir } from "./fixture/tmpdir"

// A local stand-in for either side of the contract: the design app, or the redcode server whose
// `design.host` routes the app calls back. Each records what it was asked.
type Recorded = { readonly method: string; readonly path: string; readonly headers: Headers; readonly body: string }
const stops: Array<() => Promise<void>> = []

function fake(answer: (path: string, body: string) => Response | Promise<Response>) {
  const requests: Recorded[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const route = new URL(request.url).pathname
      const body = await request.text()
      requests.push({ method: request.method, path: route, headers: request.headers, body })
      return answer(route, body)
    },
  })
  stops.push(() => server.stop(true))
  return { url: `http://127.0.0.1:${server.port}`, requests }
}

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()))
})

const sessionID = Session.ID.make("ses_design_app_host")

describe("DesignHost", () => {
  test("reads the host part of a Host header, keeping IPv6 brackets and dropping the port", () => {
    expect(DesignHost.hostOf("LocalHost:4096")).toBe("localhost")
    expect(DesignHost.hostOf("[::1]:4096")).toBe("[::1]")
    expect(DesignHost.hostOf("devbox")).toBe("devbox")
    expect(DesignHost.hostOf("  ")).toBe("")
  })

  test("answers only names that are this machine, the bound hostname or configured extras", () => {
    expect(DesignHost.allowed(undefined)).toBe(true)
    expect(DesignHost.allowed("127.0.0.1:4096")).toBe(true)
    expect(DesignHost.allowed("localhost")).toBe(true)
    expect(DesignHost.allowed("[::1]:4096")).toBe(true)
    expect(DesignHost.allowed("")).toBe(false)
    expect(DesignHost.allowed("evil.example:4096")).toBe(false)
    expect(DesignHost.allowed("review.example:4096", [" Review.Example "])).toBe(true)
  })

  test("offers another device nothing for a loopback bind and keeps a real hostname", () => {
    expect(DesignHost.networkURL(undefined)).toBeUndefined()
    expect(DesignHost.networkURL(new URL("http://127.0.0.1:4096"))).toBeUndefined()
    expect(DesignHost.networkURL(new URL("http://localhost:4096"))).toBeUndefined()
    expect(DesignHost.networkURL(new URL("http://devbox.local:4096/design"))).toBe("http://devbox.local:4096")
    const wildcard = DesignHost.networkURL(new URL("http://0.0.0.0:4096"))
    if (wildcard !== undefined) expect(wildcard).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:4096$/)
  })
})

describe("DesignApp tickets and shared token", () => {
  test("a ticket grants one session's review until it expires", () => {
    const now = 1_000_000
    const value = DesignApp.ticket("secret", sessionID, DesignApp.LINK_TTL, now)

    expect(DesignApp.verify("secret", sessionID, value, now + DesignApp.LINK_TTL - 1)).toBe(true)
    expect(DesignApp.verify("secret", sessionID, value, now + DesignApp.LINK_TTL + 1)).toBe(false)
    expect(DesignApp.verify("secret", "ses_other", value, now)).toBe(false)
    expect(DesignApp.verify("other-secret", sessionID, value, now)).toBe(false)
    expect(DesignApp.verify("secret", sessionID, `${value}x`, now)).toBe(false)
    expect(DesignApp.verify("secret", sessionID, "not-a-ticket", now)).toBe(false)
    expect(DesignApp.verify("secret", sessionID, undefined, now)).toBe(false)
  })

  test("creates the token once, readable only by this user, and reuses it", async () => {
    await using dir = await tmpdir()
    const file = DesignApp.paths(dir.path).token
    const first = await DesignApp.token(file)

    expect(first.length).toBeGreaterThan(20)
    expect(await DesignApp.token(file)).toBe(first)
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  test("a registration is removed only by the app that wrote it", async () => {
    await using dir = await tmpdir()
    const file = DesignApp.paths(dir.path).registration
    const older = await DesignApp.register({ url: "http://127.0.0.1:1", pid: process.pid, version: "0.1.0" }, file)
    const newer = await DesignApp.register({ url: "http://127.0.0.1:2", pid: process.pid, version: "0.1.0" }, file)

    expect(newer.protocol).toBe(DesignApp.PROTOCOL)
    await DesignApp.unregister(older.id, file)
    expect(await DesignApp.registration(file)).toEqual(newer)
    await DesignApp.unregister(newer.id, file)
    expect(await DesignApp.registration(file)).toBeUndefined()
  })

  test("a server bound to every interface is reached on loopback", () => {
    expect(DesignApp.loopback("http://0.0.0.0:4096/path")).toBe("http://127.0.0.1:4096")
    expect(DesignApp.loopback("http://[::]:4096")).toBe("http://127.0.0.1:4096")
    expect(DesignApp.loopback(new URL("http://devbox:4096"))).toBe("http://devbox:4096")
  })
})

describe("DesignApp.running", () => {
  const health = (protocol: number) =>
    fake((route) => {
      if (route === "/app/health") return Response.json({ healthy: true, protocol, version: "0.2.0", pid: process.pid })
      if (route === "/app/shutdown") return new Response(null, { status: 204 })
      return new Response(null, { status: 404 })
    })

  test("reuses a registered app that lives, answers with the token and speaks this protocol", async () => {
    await using dir = await tmpdir()
    const app = health(DesignApp.PROTOCOL)
    const files = DesignApp.paths(dir.path)
    await DesignApp.register({ url: app.url, pid: process.pid, version: "0.2.0" }, files.registration)

    const running = await DesignApp.running(dir.path)

    expect(running).toEqual({ url: app.url, token: await DesignApp.token(files.token) })
    expect(app.requests.map((request) => request.path)).toEqual(["/app/health"])
    expect(app.requests[0]?.headers.get("authorization")).toBe(`Bearer ${running?.token}`)
  })

  test("asks an app of another protocol to stop instead of reusing it", async () => {
    await using dir = await tmpdir()
    const app = health(DesignApp.PROTOCOL + 1)
    const file = DesignApp.paths(dir.path).registration
    await DesignApp.register({ url: app.url, pid: process.pid, version: "0.2.0" }, file)

    expect(await DesignApp.running(dir.path)).toBeUndefined()
    expect(app.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "GET /app/health",
      "POST /app/shutdown",
    ])
  })

  test("ignores a registration whose process has exited, without calling it", async () => {
    await using dir = await tmpdir()
    const app = health(DesignApp.PROTOCOL)
    const exited = Bun.spawn([process.execPath, "--version"], { stdout: "ignore", stderr: "ignore" })
    await exited.exited
    const file = DesignApp.paths(dir.path).registration
    await DesignApp.register({ url: app.url, pid: exited.pid, version: "0.2.0" }, file)

    expect(await DesignApp.running(dir.path)).toBeUndefined()
    expect(app.requests).toEqual([])
  })
})

describe("DesignApp session calls", () => {
  test("a review link attaches the Session owner first and carries a ticket for that Session", async () => {
    const app = fake(() => new Response(null, { status: 204 }))
    const connection = {
      url: app.url,
      token: "shared-token",
      host: { url: "http://127.0.0.1:4096", authorization: "Basic cmVkY29kZTpwdw==" },
    }

    const link = new URL(await DesignApp.link(connection, sessionID))

    expect(app.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `POST /design/session/${sessionID}/attach`,
    ])
    expect(app.requests[0]?.headers.get("authorization")).toBe("Bearer shared-token")
    expect(app.requests[0]?.headers.get(DesignApp.HOST_HEADER)).toBe("http://127.0.0.1:4096")
    expect(app.requests[0]?.headers.get(DesignApp.HOST_AUTHORIZATION_HEADER)).toBe("Basic cmVkY29kZTpwdw==")
    expect(link.pathname).toBe(`/design/session/${sessionID}/review`)
    expect(DesignApp.verify("shared-token", sessionID, link.searchParams.get("ticket") ?? undefined)).toBe(true)
    await expect(DesignApp.link({ url: app.url, token: "shared-token" }, sessionID)).rejects.toThrow(
      "The design app has no server for this Session",
    )
  })

  test("private calls cancel a stalled response body without waiting for the app", async () => {
    const started = Promise.withResolvers<void>()
    const app = fake(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"ready":'))
              started.resolve()
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    )
    const controller = new AbortController()
    const result = DesignApp.call(
      { url: app.url, token: "shared-token" },
      sessionID,
      "/job",
      Schema.Struct({ ready: Schema.Boolean }),
      undefined,
      controller.signal,
    ).then(
      () => "completed",
      () => "cancelled",
    )
    await started.promise
    controller.abort()
    expect(await result).toBe("cancelled")
    expect(app.requests).toHaveLength(1)
  })

  test("private calls decode the answer and turn failures into Design errors", async () => {
    const app = fake((route) => {
      if (route.endsWith("/busy"))
        return Response.json({ code: "conflict", message: "A build is running" }, { status: 409 })
      if (route.endsWith("/broken")) return new Response("oops", { status: 500 })
      if (route.endsWith("/shape")) return Response.json({ ready: "yes" })
      return Response.json({ ready: true })
    })
    const connection = { url: app.url, token: "shared-token" }
    const Ready = Schema.Struct({ ready: Schema.Boolean })
    const failure = (route: string) =>
      DesignApp.call(connection, sessionID, route, Ready).then(
        () => undefined,
        (error: unknown) => (error instanceof Design.Error ? { code: error.code, message: error.message } : error),
      )

    expect(await DesignApp.call(connection, sessionID, "/ok", Ready, { go: true })).toEqual({ ready: true })
    expect(app.requests[0]).toMatchObject({ method: "POST", body: JSON.stringify({ go: true }) })
    expect(await failure("/busy")).toEqual({ code: "conflict", message: "A build is running" })
    expect(await failure("/broken")).toEqual({ code: "unavailable", message: "The design app answered HTTP 500" })
    expect(await failure("/shape")).toEqual({
      code: "unavailable",
      message: "The design app returned an invalid response",
    })
  })

  test("serves only the known legacy vendor assets", async () => {
    const app = fake(() => new Response("tailwind"))
    const connection = { url: app.url, token: "shared-token" }

    expect(await DesignApp.vendor(connection, "tailwind.js")).toBe("tailwind")
    await expect(DesignApp.vendor(connection, "../secret.js")).rejects.toBeInstanceOf(Design.Error)
    expect(app.requests.map((request) => request.path)).toEqual(["/app/vendor/tailwind.js"])
  })
})

describe("DesignAppHost", () => {
  test("asks the owning redcode for each canonical read and refuses what it declines", async () => {
    await using dir = await tmpdir()
    const allowed = path.join(dir.path, "tokens.css")
    const declined = path.join(dir.path, "secret.css")
    await Bun.write(allowed, ":root{}")
    await Bun.write(declined, "body{}")
    const canonical = await realpath(allowed)
    const expected = JSON.stringify({ kind: "read", path: canonical })
    const host = fake((_, body) => Response.json({ granted: body === expected }))
    const read = DesignAppHost.reader({ url: host.url, authorization: "Bearer host" }, sessionID)

    await read(allowed)
    await expect(read(declined)).rejects.toThrow("Read permission was refused")
    expect(host.requests.map((request) => request.path)).toEqual([
      `/design/session/${sessionID}/permission`,
      `/design/session/${sessionID}/permission`,
    ])
    expect(host.requests[0]?.body).toBe(expected)
    expect(host.requests[0]?.headers.get("authorization")).toBe("Bearer host")
  })

  test("fails when redcode answers without a decision", async () => {
    await using dir = await tmpdir()
    const file = path.join(dir.path, "tokens.css")
    await Bun.write(file, ":root{}")
    const host = fake(() => Response.json({ maybe: true }))

    await expect(DesignAppHost.reader({ url: host.url }, sessionID)(file)).rejects.toThrow("without a decision")
  })
})

describe("DesignAppMode.process", () => {
  test("a source checkout delegates to the design app only when configured to", () => {
    expect(DesignAppMode.process()).toBe(false)
    expect(DesignAppMode.process({ app: { mode: "inline" } })).toBe(false)
    expect(DesignAppMode.process({ app: { mode: "process" } })).toBe(true)
  })
})
