import { expect, test } from "bun:test"
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
