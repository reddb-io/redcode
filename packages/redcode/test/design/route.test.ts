import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import path from "path"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { DesignRegistry } from "@/design/registry"
import { SessionPrompt } from "@/session/prompt"
import { serveDesignEffect } from "../../src/server/shared/design"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { SessionID } from "@/session/schema"

/** What the agent would have been told, without running a turn to find out. */
type Part = { type: string; text?: string; mime?: string; url?: string; filename?: string }
const delivered: { sessionID: string; text: string; parts: readonly Part[] }[] = []

const promptStub = Layer.succeed(
  SessionPrompt.Service,
  SessionPrompt.Service.of({
    prompt: (input: { sessionID: string; parts: readonly Part[] }) =>
      Effect.sync(() => {
        delivered.push({
          sessionID: input.sessionID,
          text: input.parts.map((p) => p.text ?? "").join(""),
          parts: input.parts,
        })
        return {} as never
      }),
  } as never),
)

const it = testEffect(
  LayerNode.compile(LayerNode.group([DesignRegistry.node, FSUtil.node])).pipe(Layer.provideMerge(promptStub)),
)

const call = (target: string, init?: RequestInit) =>
  Effect.gen(function* () {
    const request = HttpServerRequest.fromWeb(new Request(new URL(target, "http://127.0.0.1:4096"), init))
    const response = yield* serveDesignEffect(request)
    return response
  })

const prototypeIn = (directory: string, name: string, files: Record<string, string>) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const root = path.join(directory, name)
    yield* fs.ensureDir(root)
    for (const [file, body] of Object.entries(files)) {
      yield* Effect.promise(() => Bun.write(path.join(root, file), body))
    }
    const registry = yield* DesignRegistry.Service
    return yield* registry.register({ sessionID: SessionID.make("ses_design"), root, name })
  })

describe("the design surface", () => {
  it.instance("serves the prototype where it cannot reach anything, with the review SDK inside", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "hero", {
        "index.html": "<html><head></head><body>hi</body></html>",
      })

      const page = yield* call(`/design/${prototype.id}/files/index.html`)
      expect(page.status).toBe(200)
      const csp = String(page.headers["content-security-policy"] ?? "")
      expect(csp).toContain("sandbox allow-scripts")
      expect(csp).not.toContain("allow-same-origin")
      expect(csp).toContain("connect-src 'none'")

      const shell = yield* call(`/design/${prototype.id}`)
      expect(shell.status).toBe(200)
      expect(String(shell.headers["content-security-policy"])).toContain("default-src 'none'")
      expect(shell.headers["referrer-policy"]).toBe("no-referrer")
    }),
  )

  it.instance("the revision poll is the heartbeat", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "beat", { "index.html": "<html></html>" })
      const registry = yield* DesignRegistry.Service
      expect((yield* registry.get(prototype.id))!.lastSeen).toBeUndefined()
      const polled = yield* call(`/design/${prototype.id}/revision`, {
        headers: { "x-redcode-design-token": prototype.token },
      })
      expect(polled.status).toBe(200)
      expect(typeof (yield* registry.get(prototype.id))!.lastSeen).toBe("number")
    }),
  )

  it.instance("serves only what belongs to a page", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "guarded", {
        "index.html": "<html></html>",
        "secrets.env": "TOKEN=1",
      })
      expect((yield* call(`/design/${prototype.id}/files/secrets.env`)).status).toBe(404)
      expect((yield* call(`/design/${prototype.id}/files/../../outside.html`)).status).toBe(404)
      expect((yield* call(`/design/unknown/files/index.html`)).status).toBe(404)
    }),
  )

  it.instance("takes feedback only from a surface opened for this prototype, and writes the words itself", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "feedback", { "index.html": "<html></html>" })
      delivered.length = 0

      const body = JSON.stringify({
        items: [{ label: "button.cta", text: "less shouty", selection: "Get started" }],
        viewport: { width: 1280, height: 800 },
      })
      const headers = { "content-type": "application/json" }

      expect((yield* call(`/design/${prototype.id}/feedback`, { method: "POST", headers, body })).status).toBe(403)
      expect(
        (yield* call(`/design/${prototype.id}/feedback`, {
          method: "POST",
          headers: { ...headers, "x-redcode-design-token": "wrong" },
          body,
        })).status,
      ).toBe(403)
      expect(delivered).toHaveLength(0)

      const accepted = yield* call(`/design/${prototype.id}/feedback`, {
        method: "POST",
        headers: { ...headers, "x-redcode-design-token": prototype.token },
        body,
      })
      expect(accepted.status).toBe(202)

      // The browser sent annotations; the server wrote the message.
      expect(delivered).toHaveLength(1)
      expect(delivered[0]!.sessionID).toBe("ses_design")
      expect(delivered[0]!.text).toContain("<design-feedback")
      expect(delivered[0]!.text).toContain('viewport="1280x800"')
      expect(delivered[0]!.text).toContain("[button.cta]")
      expect(delivered[0]!.text).toContain('(selected: "Get started")')
      expect(delivered[0]!.text).toContain("less shouty")
    }),
  )

  it.instance("carries a pasted image as a file part, and refuses a body that is too big", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "picture", { "index.html": "<html></html>" })
      delivered.length = 0
      const headers = { "content-type": "application/json", "x-redcode-design-token": prototype.token }
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(32),
      ]).toString("base64")

      const accepted = yield* call(`/design/${prototype.id}/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: [{ label: "h1", text: "more like this", image: { mime: "image/png", data: png } }],
        }),
      })
      expect(accepted.status).toBe(202)
      expect(delivered[0]!.parts.map((p) => p.type)).toEqual(["text", "file"])
      expect(delivered[0]!.parts[1]).toMatchObject({ mime: "image/png", filename: "design-feedback-1.png" })
      expect(delivered[0]!.parts[1]!.url).toBe(`data:image/png;base64,${png}`)
      expect(delivered[0]!.text).toContain("(image attached: design-feedback-1)")

      // A body past the cap never reaches the parser, let alone the session.
      delivered.length = 0
      const flood = yield* call(`/design/${prototype.id}/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: [{ text: "x", image: { mime: "image/png", data: "A".repeat(4 * 1024 * 1024) } }],
        }),
      })
      expect(flood.status).toBe(413)
      expect(delivered).toHaveLength(0)
    }),
  )
})

describe("the review's life over the wire", () => {
  it.instance("the event stream opens with the conversation and where the review stands", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "live", { "index.html": "<html></html>" })
      const registry = yield* DesignRegistry.Service
      yield* registry.say(prototype.id, { role: "user", text: "hello" })

      expect((yield* call(`/design/${prototype.id}/events`)).status).toBe(403)
      const stream = yield* call(`/design/${prototype.id}/events?token=${prototype.token}`)
      expect(stream.status).toBe(200)
      expect(String(stream.headers["content-type"])).toContain("text/event-stream")
      // The first frame, then close: the stream stays open until the shell leaves.
      const body = yield* Effect.scoped(
        Effect.gen(function* () {
          const web = HttpServerResponse.toWeb(stream)
          const reader = web.body!.getReader()
          const chunk = yield* Effect.promise(() => reader.read())
          yield* Effect.promise(() => reader.cancel())
          return new TextDecoder().decode(chunk.value)
        }),
      )
      expect(body).toContain("event: chat-sync")
      expect(body).toContain("hello")
    }),
  )

  it.instance("ending is the person's act: token and origin, then nothing more arrives", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "over", { "index.html": "<html></html>" })
      const headers = {
        "content-type": "application/json",
        "x-redcode-design-token": prototype.token,
        host: "127.0.0.1:4096",
      }
      // Another site's page, holding the token somehow, still cannot end or send.
      expect(
        (yield* call(`/design/${prototype.id}/end`, {
          method: "POST",
          headers: { ...headers, origin: "https://evil.example" },
        })).status,
      ).toBe(403)
      expect(
        (yield* call(`/design/${prototype.id}/end`, {
          method: "POST",
          headers: { ...headers, origin: "http://127.0.0.1:4096" },
        })).status,
      ).toBe(200)
      expect((yield* DesignRegistry.Service.pipe(Effect.flatMap((r) => r.get(prototype.id))))!.ended?.by).toBe("user")

      delivered.length = 0
      const late = yield* call(`/design/${prototype.id}/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({ items: [{ text: "one more" }] }),
      })
      expect(late.status).toBe(409)
      expect(delivered).toHaveLength(0)
    }),
  )

  it.instance("a send with the end flag delivers the words, marks the end, and the block says so", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "last", { "index.html": "<html></html>" })
      delivered.length = 0
      const sent = yield* call(`/design/${prototype.id}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-redcode-design-token": prototype.token },
        body: JSON.stringify({
          items: [
            { tag: "message", text: "ship it" },
            { selector: "h1", text: "bigger" },
          ],
          snapshot: "uid=1 body",
          end: true,
        }),
      })
      expect(sent.status).toBe(202)
      expect(delivered[0]!.text).toContain('ended="user"')
      expect(delivered[0]!.text).toContain("<dom-snapshot>")
      const registry = yield* DesignRegistry.Service
      const after = (yield* registry.get(prototype.id))!
      expect(after.ended?.by).toBe("user")
      expect(after.chat.map((c) => c.text)).toEqual(["ship it\n(1 annotation sent)"])
    }),
  )

  it.instance("the review's own state is never served", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "private", { "index.html": "<html></html>" })
      expect((yield* call(`/design/${prototype.id}/files/.review/state.json`)).status).toBe(404)
    }),
  )
})
