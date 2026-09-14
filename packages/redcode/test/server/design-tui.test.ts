import { expect, test } from "bun:test"
import path from "node:path"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { tmpdir } from "../fixture/fixture"

/** Exercises the legacy session HTTP boundary used by the fullscreen TUI. */
test("TUI session creates, reviews and approves the new Design artifacts in the same conversation", async () => {
  const model = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const input = await request.json()
      if (!input.stream)
        return Response.json({
          id: "fixture",
          model: "fixture",
          choices: [{ index: 0, message: { role: "assistant", content: "Design review" }, finish_reason: "stop" }],
        })
      return new Response(
        'data: {"id":"fixture","model":"fixture","choices":[{"index":0,"delta":{"content":"Feedback received."},"finish_reason":null}]}\n\ndata: {"id":"fixture","model":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  await using tmp = await tmpdir({
    git: true,
    config: {
      model: "fixture/fixture",
      provider: {
        fixture: {
          npm: "@ai-sdk/openai-compatible",
          models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4096 } } },
          options: { apiKey: "fixture", baseURL: model.url.origin + "/v1" },
        },
      },
    },
  })
  // This fixture owns its handler; disposing the process-global handler breaks later server tests.
  const server = HttpRouter.toWebHandler(HttpApiApp.createRoutes(), { disableLogger: true })
  const request = async (route: string, method = "GET", body?: unknown) =>
    server.handler(
      new Request(`http://localhost${route}`, {
        method,
        headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      HttpApiApp.context,
    )
  try {
    const created = await request("/session", "POST", { agent: "design" })
    expect(created.status).toBe(200)
    const session = await created.json()
    const root = `/design/session/${session.id}`
    const response = await request(root, "POST", { name: "Checkout", engine: "html", journey: "new", kind: "screen" })
    expect(response.status).toBe(200)
    const document = await response.json()
    expect(document.sessionID).toBe(session.id)
    await Bun.write(
      document.root + "/index.html",
      "<!doctype html><html><body><button>Save draft</button></body></html>",
    )
    const published = await request(`${root}/${document.id}/revision`, "POST", { name: "First direction" })
    expect(published.status).toBe(200)
    const revision = await published.json()
    const review = await request(`${root}/review`)
    expect(review.status).toBe(200)
    expect(await review.text()).toContain(`"endpoint":"${root}"`)
    const preview = await request(`${root}/${document.id}/revision/${revision.id}/preview`)
    expect(preview.status).toBe(200)
    expect(await preview.text()).toContain("Save draft")
    const asset = await request(`${root}/${document.id}/asset`, "POST", {
      name: "mark.svg",
      mime: "image/svg+xml",
      data: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="4"/></svg>',
      ).toString("base64"),
      source: "upload",
    })
    expect(asset.status).toBe(200)
    expect((await (await request(`${root}/${document.id}/asset`)).json()).length).toBe(1)
    expect((await request(`${root}/${document.id}/job`)).status).toBe(200)
    const other = await (await request("/session", "POST", {})).json()
    expect((await request(`/design/session/${other.id}/${document.id}`)).status).toBe(404)
    const feedback = {
      id: "msg_tui_feedback",
      revision: revision.id,
      text: "Increase the Save button contrast",
      items: [],
      assets: [],
      snapshot: "",
      delivery: "steer",
      end: false,
    }
    const receipts = await Promise.all([
      request(`${root}/${document.id}/feedback`, "POST", feedback),
      request(`${root}/${document.id}/feedback`, "POST", feedback),
    ])
    expect(receipts.map((response) => response.status)).toEqual([200, 200])
    expect(
      (await request(`${root}/${document.id}/feedback`, "POST", { ...feedback, text: "conflicting retry" })).status,
    ).toBe(409)
    const transcript = await (await request(`/session/${session.id}/message`)).json()
    expect(transcript.filter((message: { info: { id: string } }) => message.info.id === feedback.id)).toHaveLength(1)
    // The conversation feed replays the transcript: the review as a notice, the agent's reply after it.
    const feed = await request(`${root}/feed?after=0`)
    expect(feed.status).toBe(200)
    expect(feed.headers.get("content-type")).toContain("text/event-stream")
    const reader = feed.body!.getReader()
    const decoder = new TextDecoder()
    const chunks: string[] = []
    while (!chunks.join("").includes('"type":"reply"')) {
      const chunk = await reader.read()
      if (chunk.done) break
      chunks.push(decoder.decode(chunk.value, { stream: true }))
    }
    await reader.cancel()
    const entries = chunks
      .join("")
      .split("\n\n")
      .flatMap((block) => block.split("\n").filter((line) => line.startsWith("data:")))
      .map((line) => JSON.parse(line.slice(5)))
    expect(entries[0]).toMatchObject({ type: "agent", agent: "design" })
    expect(entries[1]).toMatchObject({ type: "state", state: "idle" })
    expect(entries).toContainEqual(
      expect.objectContaining({ type: "user", id: feedback.id, text: "Increase the Save button contrast", notes: 0 }),
    )
    expect(entries).toContainEqual(expect.objectContaining({ type: "reply", text: "Feedback received." }))
    expect(entries.indexOf(entries.find((entry) => entry.type === "user")!)).toBeLessThan(
      entries.indexOf(entries.find((entry) => entry.type === "reply")!),
    )
    expect((await request(`${root}/feed?after=-1`)).status).toBe(400)
    expect((await request(`${root}/feed`, "POST", {})).status).toBe(400)
    // A page that reconnects with a cursor from before a TUI restart still gets the transcript and live news:
    // the legacy route replays everything and ignores `after`, so no in-memory counter can strand it.
    const resumed = await request(`${root}/feed?after=57`)
    expect(resumed.status).toBe(200)
    const resumedReader = resumed.body!.getReader()
    const resumedChunks: string[] = []
    const read = async (until: string, times = 1) => {
      while (resumedChunks.join("").split(until).length <= times) {
        const chunk = await resumedReader.read()
        if (chunk.done) break
        resumedChunks.push(decoder.decode(chunk.value, { stream: true }))
      }
    }
    await read('"type":"reply"')
    const replayed = resumedChunks.join("")
    expect(replayed).toContain(`"id":"${feedback.id}"`)
    const live = await request(`${root}/${document.id}/feedback`, "POST", {
      ...feedback,
      id: "msg_tui_feedback_live",
      text: "Now align the totals",
    })
    expect(live.status).toBe(200)
    // The fixture model answers the new review; its reply closes the live turn on the open stream.
    await read('"type":"reply"', 2)
    await resumedReader.cancel()
    const liveEntries = resumedChunks
      .join("")
      .slice(replayed.length)
      .split("\n\n")
      .flatMap((block) => block.split("\n").filter((line) => line.startsWith("data:")))
      .map((line) => JSON.parse(line.slice(5)))
    expect(liveEntries).toContainEqual(
      expect.objectContaining({ type: "user", id: "msg_tui_feedback_live", text: "Now align the totals", seq: 0 }),
    )
    expect(liveEntries).toContainEqual(expect.objectContaining({ type: "state", state: "working" }))
    expect(liveEntries).toContainEqual(expect.objectContaining({ type: "reply", text: "Feedback received." }))
    const collision = await request(`/session/${session.id}/message`, "POST", {
      messageID: "msg_existing_message",
      agent: "design",
      noReply: true,
      parts: [{ type: "text", text: "Keep this original message" }],
    })
    expect(collision.status).toBe(200)
    expect(
      (
        await request(`${root}/${document.id}/feedback`, "POST", {
          ...feedback,
          id: "msg_existing_message",
        })
      ).status,
    ).toBe(409)
    const approvals = await Promise.all([
      request(`${root}/${document.id}/approve`, "POST", { revision: revision.id }),
      request(`${root}/${document.id}/approve`, "POST", { revision: revision.id }),
    ])
    expect(approvals.map((response) => response.status)).toEqual([200, 200])
    const approval = approvals[0]
    expect(approval.status).toBe(200)
    const result = await approval.json()
    expect(result.agent).toBe("plan")
    expect(await Bun.file(result.plan).text()).toContain(revision.id)
    expect((await (await request(`/session/${session.id}`)).json()).agent).toBe("plan")
    const messages = await (await request(`/session/${session.id}/message`)).json()
    expect(
      messages.filter(
        (message: { info: { role: string; agent: string } }) =>
          message.info.role === "user" && message.info.agent === "plan",
      ),
    ).toHaveLength(1)
    expect(
      messages.some(
        (message: { info: { agent: string }; parts: { text?: string }[] }) =>
          message.info.agent === "plan" && message.parts.some((part) => part.text?.includes(revision.id)),
      ),
    ).toBe(true)
  } finally {
    await server.dispose()
    await model.stop(true)
  }
}, 60000)

test("Design picker groups prototypes by conversation and excludes other workspaces and deleted sessions", async () => {
  await using first = await tmpdir({ git: true })
  await using second = await tmpdir({ git: true })
  const server = HttpRouter.toWebHandler(HttpApiApp.createRoutes(), { disableLogger: true })
  const request = (directory: string, route: string, method = "GET", body?: unknown) =>
    server.handler(
      new Request(`http://localhost${route}`, {
        method,
        headers: { "content-type": "application/json", "x-opencode-directory": directory },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      HttpApiApp.context,
    )
  try {
    const session = await (await request(first.path, "/session", "POST", { agent: "design" })).json()
    await request(first.path, "/session", "POST", {})
    const pending = await (await request(first.path, "/session", "POST", { agent: "design" })).json()
    for (const name of ["Dark mode", "Mobile layout"]) {
      const response = await request(first.path, `/design/session/${session.id}`, "POST", {
        name,
        engine: "html",
        journey: "new",
        kind: "screen",
      })
      expect(response.status).toBe(200)
    }
    expect((await request(first.path, "/design/list")).status).toBe(400)
    const list = `/design/list?directory=${encodeURIComponent(first.path)}`
    const response = await request(first.path, list)
    expect(response.status).toBe(200)
    const conversations = await response.json()
    expect(conversations).toHaveLength(2)
    expect(conversations).toContainEqual({
      sessionID: pending.id,
      title: pending.title,
      updated: expect.any(Number),
      designs: [],
    })
    const conversation = conversations.find((item: { sessionID: string }) => item.sessionID === session.id)
    expect(conversation.designs.map((design: { name: string }) => design.name).sort()).toEqual([
      "Dark mode",
      "Mobile layout",
    ])
    expect(conversation.designs[0]).not.toHaveProperty("root")
    expect(
      await (await request(second.path, `/design/list?directory=${encodeURIComponent(second.path)}`)).json(),
    ).toEqual([])
    expect((await request(first.path, `/session/${session.id}`, "DELETE")).status).toBe(200)
    expect(await (await request(first.path, list)).json()).toMatchObject([{ sessionID: pending.id, designs: [] }])
    expect((await request(first.path, `/session/${pending.id}`, "DELETE")).status).toBe(200)
    expect(await (await request(first.path, list)).json()).toEqual([])
  } finally {
    await server.dispose()
  }
}, 30000)

// A published HTML revision may contain a missing local resource. Keep the
// failure actionable at the same HTTP boundary as the fullscreen TUI.
test("TUI preview reports a missing resource without an opaque internal error", async () => {
  await using tmp = await tmpdir({ git: true })
  const server = HttpRouter.toWebHandler(HttpApiApp.createRoutes(), { disableLogger: true })
  const request = (route: string, method = "GET", body?: unknown) =>
    server.handler(
      new Request(`http://localhost${route}`, {
        method,
        headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      HttpApiApp.context,
    )
  try {
    const session = await (await request("/session", "POST", { agent: "design" })).json()
    const root = `/design/session/${session.id}`
    const document = await (
      await request(root, "POST", { name: "Missing CSS", engine: "html", journey: "new", kind: "screen" })
    ).json()
    await Bun.write(
      `${document.root}/index.html`,
      '<!doctype html><html><head><link rel="stylesheet" href="missing.css"></head><body><section data-design-variant="a">Variant A</section></body></html>',
    )
    const revision = await (
      await request(`${root}/${document.id}/revision`, "POST", { name: "Missing stylesheet" })
    ).json()
    const preview = await request(`${root}/${document.id}/revision/${revision.id}/preview`)
    expect(preview.status).toBe(409)
    expect((await preview.json()).message).toContain("missing.css")
  } finally {
    await server.dispose()
  }
}, 60000)

for (const decision of ["deny", "allow"] as const)
  test(`TUI review publish and restore routes honour a user ${decision} on project tooling`, async () => {
    await using tmp = await tmpdir({
      config: {
        permission: { project_tooling: decision },
        design: { system: { paths: ["src/components"], css: ["src/styles/globals.css"] } },
      },
    })
    const { cp } = await import("node:fs/promises")
    const { materializeDependencies } = await import("../../../core/test/fixture/design-dependencies")
    await cp(path.join(import.meta.dir, "../../../core/test/fixture/tailwind"), tmp.path, { recursive: true })
    await materializeDependencies(tmp.path, ["react", "react-dom", "tailwindcss", "autoprefixer"])
    const server = HttpRouter.toWebHandler(HttpApiApp.createRoutes(), { disableLogger: true })
    const request = async (route: string, method = "GET", body?: unknown) =>
      server.handler(
        new Request(`http://localhost${route}`, {
          method,
          headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        HttpApiApp.context,
      )
    try {
      const session = await (await request("/session", "POST", { agent: "design" })).json()
      const root = `/design/session/${session.id}`
      const document = await (
        await request(root, "POST", { name: "Tooling", engine: "react", journey: "existing", kind: "screen" })
      ).json()
      expect(document.system?.tailwind).toBe(true)
      await Bun.write(
        path.join(document.root, document.entry),
        'import { createRoot } from "react-dom/client"\nimport { Button } from "@/components/Button"\ncreateRoot(document.getElementById("root")!).render(<main className="p-4"><Button>Buy</Button></main>)\n',
      )
      const published = await request(`${root}/${document.id}/revision`, "POST", { name: "First" })
      // The body carries the build error, so a failure shows why the revision was refused.
      const revision = await published.json()
      expect({ status: published.status, body: revision }).toMatchObject({ status: 200 })
      expect(revision.document.system?.tailwind).toBe(decision === "allow")
      const preview = await (await request(`${root}/${document.id}/revision/${revision.id}/preview`)).text()
      if (decision === "allow") expect(preview).toContain(".p-4{")
      if (decision === "deny") expect(preview).not.toContain(".p-4{")
      const restored = await request(`${root}/${document.id}/restore`, "POST", { revision: revision.id })
      const body = await restored.json()
      expect({ status: restored.status, body }).toMatchObject({ status: 200 })
      expect(body.document.system?.tailwind).toBe(decision === "allow")
    } finally {
      await server.dispose()
    }
  }, 120000)

test("legacy feed reports a variant operation pending while an earlier turn works and delivered once a turn takes it up", async () => {
  // The first streamed turn is held open so the operation is admitted while the agent is working.
  const release = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const streamed = { count: 0 }
  const model = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const input = await request.json()
      if (!input.stream)
        return Response.json({
          id: "fixture",
          model: "fixture",
          choices: [{ index: 0, message: { role: "assistant", content: "Title" }, finish_reason: "stop" }],
        })
      streamed.count++
      if (streamed.count === 1) {
        started.resolve()
        await release.promise
      }
      return new Response(
        'data: {"id":"fixture","model":"fixture","choices":[{"index":0,"delta":{"content":"Working on it."},"finish_reason":null}]}\n\ndata: {"id":"fixture","model":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  await using tmp = await tmpdir({
    git: true,
    config: {
      model: "fixture/fixture",
      provider: {
        fixture: {
          npm: "@ai-sdk/openai-compatible",
          models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4096 } } },
          options: { apiKey: "fixture", baseURL: model.url.origin + "/v1" },
        },
      },
    },
  })
  const server = HttpRouter.toWebHandler(HttpApiApp.createRoutes(), { disableLogger: true })
  const request = async (route: string, method = "GET", body?: unknown) =>
    server.handler(
      new Request(`http://localhost${route}`, {
        method,
        headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      HttpApiApp.context,
    )
  type Entry = { type: string; id?: string; state?: string; text?: string; pending?: boolean }
  /** Follows one feed connection, collecting its entries as they arrive. */
  const follow = async (route: string) => {
    const response = await request(route)
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const entries: Entry[] = []
    let buffer = ""
    const pump = (async () => {
      while (true) {
        const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }))
        if (chunk.done) return
        buffer += decoder.decode(chunk.value, { stream: true })
        const blocks = buffer.split("\n\n")
        buffer = blocks.pop() ?? ""
        for (const block of blocks)
          for (const line of block.split("\n")) if (line.startsWith("data:")) entries.push(JSON.parse(line.slice(5)))
      }
    })()
    return {
      entries,
      close: async () => {
        await reader.cancel().catch(() => undefined)
        await pump
      },
    }
  }
  const until = async (check: () => boolean, message: string, timeout = 30000) => {
    const deadline = Date.now() + timeout
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${message}`)
      await Bun.sleep(25)
    }
  }
  const feeds: { close: () => Promise<void> }[] = []
  try {
    const session = await (await request("/session", "POST", { agent: "design" })).json()
    const root = `/design/session/${session.id}`
    const document = await (
      await request(root, "POST", { name: "Checkout", engine: "html", journey: "new", kind: "screen" })
    ).json()
    await Bun.write(
      document.root + "/index.html",
      '<!doctype html><html><body><section data-design-variant="compact" data-design-label="Compact">Compact</section><section data-design-variant="spacious" data-design-label="Spacious">Spacious</section></body></html>',
    )
    const revision = await (await request(`${root}/${document.id}/revision`, "POST", { name: "Two directions" })).json()
    const feed = await follow(`${root}/feed?after=0`)
    feeds.push(feed)
    const start = await request(`/session/${session.id}/prompt_async`, "POST", {
      parts: [{ type: "text", text: "Start on the checkout" }],
    })
    expect(start.status).toBeLessThan(300)
    await Promise.race([
      started.promise,
      Bun.sleep(30000).then(() => {
        throw new Error("The turn never reached the model")
      }),
    ])
    await until(() => feed.entries.some((entry) => entry.type === "state" && entry.state === "working"), "working")
    const operation = {
      id: "msg_tui_variant_operation",
      revision: revision.id,
      text: "",
      items: [],
      assets: [],
      snapshot: "",
      delivery: "steer",
      end: false,
      action: { kind: "delete", variants: ["compact"], labels: ["Compact"] },
    }
    expect((await request(`${root}/${document.id}/feedback`, "POST", operation)).status).toBe(200)
    const mine = (entry: Entry) => entry.type === "user" && entry.id === operation.id
    await until(() => feed.entries.some(mine), "the operation's entry")
    const admitted = feed.entries.findIndex(mine)
    expect(feed.entries[admitted]).toMatchObject({ text: "Variant operation: delete Compact", pending: true })
    // A reconnect while the turn still runs replays it pending too.
    const early = await follow(`${root}/feed?after=0`)
    feeds.push(early)
    await until(() => early.entries.some(mine), "the replayed pending entry")
    expect(early.entries.find(mine)).toMatchObject({ pending: true })
    await early.close()
    expect(feed.entries.some((entry) => mine(entry) && !entry.pending)).toBe(false)
    release.resolve()
    await until(() => feed.entries.some((entry) => mine(entry) && !entry.pending), "the delivered entry")
    const delivered = feed.entries.findIndex((entry) => mine(entry) && !entry.pending)
    await until(
      () => feed.entries.slice(delivered).some((entry) => entry.type === "state" && entry.state === "idle"),
      "idle after delivery",
    )
    // The turn that was running when it arrived never went idle without taking it up.
    expect(
      feed.entries.slice(admitted, delivered).some((entry) => entry.type === "state" && entry.state === "idle"),
    ).toBe(false)
    // After promotion a reconnect replays it delivered.
    const later = await follow(`${root}/feed?after=0`)
    feeds.push(later)
    await until(() => later.entries.some(mine), "the replayed delivered entry")
    expect(later.entries.find(mine)).not.toHaveProperty("pending")
  } finally {
    release.resolve()
    for (const feed of feeds) await feed.close()
    await server.dispose()
    await model.stop(true)
  }
}, 90000)

// The Design tool and `redcode design` open no second tab while a review page follows the feed.
test("the legacy review feed counts connected review pages for the open route", async () => {
  await using tmp = await tmpdir({ git: true })
  const server = HttpRouter.toWebHandler(HttpApiApp.createRoutes(), { disableLogger: true })
  const request = (route: string, init: RequestInit = {}) =>
    server.handler(
      new Request(`http://localhost${route}`, {
        ...init,
        headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
      }),
      HttpApiApp.context,
    )
  const connected = async (id: string) =>
    (await (await request(`/design/session/${id}/open`)).json()).connected as number
  try {
    const session = await (
      await request("/session", { method: "POST", body: JSON.stringify({ agent: "design" }) })
    ).json()
    expect(await connected(session.id)).toBe(0)
    const abort = new AbortController()
    const feed = await request(`/design/session/${session.id}/feed`, { signal: abort.signal })
    expect(feed.status).toBe(200)
    const reader = feed.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    expect(await connected(session.id)).toBe(1)
    await reader.cancel()
    abort.abort()
    const deadline = Date.now() + 5000
    while ((await connected(session.id)) !== 0 && Date.now() < deadline) await Bun.sleep(50)
    expect(await connected(session.id)).toBe(0)
  } finally {
    await server.dispose()
  }
}, 60000)
