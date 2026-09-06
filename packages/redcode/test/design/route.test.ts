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

/** The body of a response, the way a browser would read it. */
const bodyOf = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.promise(() => HttpServerResponse.toWeb(response).text())

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

describe("images attached to a note", () => {
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from("IHDR", "ascii"),
    Buffer.from([0, 0, 0, 0x20, 0, 0, 0, 0x10]),
    Buffer.alloc(40),
  ])

  it.instance("are uploaded by our page, served back to it, and delivered to the agent as files on disk", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "pictures", { "index.html": "<html></html>" })
      const auth = { "x-redcode-design-token": prototype.token, host: "127.0.0.1:4096" }

      expect((yield* call(`/design/${prototype.id}/attachments`, { method: "POST", body: PNG })).status).toBe(403)
      expect(
        (yield* call(`/design/${prototype.id}/attachments`, {
          method: "POST",
          headers: { ...auth, origin: "https://evil.example" },
          body: PNG,
        })).status,
      ).toBe(403)
      const uploaded = yield* call(`/design/${prototype.id}/attachments`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/octet-stream" },
        body: PNG,
      })
      expect(uploaded.status).toBe(200)
      const { attachment } = JSON.parse(yield* bodyOf(uploaded)) as {
        attachment: { id: string; mime: string; width: number }
      }
      expect(attachment.mime).toBe("image/png")
      expect(attachment.width).toBe(32)

      const fetched = yield* call(`/design/${prototype.id}/attachments/${attachment.id}?token=${prototype.token}`)
      expect(fetched.status).toBe(200)
      expect(fetched.headers["content-type"]).toBe("image/png")
      expect((yield* call(`/design/${prototype.id}/attachments/${attachment.id}`)).status).toBe(403)
      expect(
        (yield* call(`/design/${prototype.id}/attachments/${"0".repeat(64)}.png?token=${prototype.token}`)).status,
      ).toBe(404)

      delivered.length = 0
      const sent = yield* call(`/design/${prototype.id}/feedback`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          items: [{ selector: "h1", text: "like this", attachments: [{ id: attachment.id, name: "ref.png" }] }],
        }),
      })
      expect(sent.status).toBe(202)
      expect(delivered[0]!.parts.map((p) => p.type)).toEqual(["text", "file"])
      expect(delivered[0]!.parts[1]).toMatchObject({ mime: "image/png", filename: "ref.png" })
      expect(delivered[0]!.parts[1]!.url).toMatch(/^file:\/\//)
      // Delivered images stay referenced, so a chip removal cannot delete them from under the turn.
      const registry = yield* DesignRegistry.Service
      expect((yield* registry.get(prototype.id))!.delivered.map((d) => d.id)).toEqual([attachment.id])
      const removal = yield* call(`/design/${prototype.id}/attachments/${attachment.id}`, {
        method: "DELETE",
        headers: auth,
      })
      expect(JSON.parse(yield* bodyOf(removal))).toEqual({ status: "referenced" })
    }),
  )

  it.instance("a send with an image it cannot honour is refused whole, and says which cap", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "refused", { "index.html": "<html></html>" })
      const headers = { "x-redcode-design-token": prototype.token, "content-type": "application/json" }
      delivered.length = 0
      const missing = yield* call(`/design/${prototype.id}/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: [{ text: "ok", attachments: [{ id: "0".repeat(64) + ".png" }] }, { text: "also" }],
        }),
      })
      expect(missing.status).toBe(400)
      const body = JSON.parse(yield* bodyOf(missing)) as { error: string; rejected: { reason: string }[] }
      expect(body.error).toContain("no longer available")
      expect(body.rejected[0]!.reason).toBe("not-found")
      expect(delivered).toHaveLength(0)

      const notImage = yield* call(`/design/${prototype.id}/attachments`, {
        method: "POST",
        headers: { "x-redcode-design-token": prototype.token },
        body: Buffer.from("<svg onload=alert(1)>"),
      })
      expect(notImage.status).toBe(415)
    }),
  )
})

describe("the design assets we ship", () => {
  it.instance("are served to any prototype, and the prototype's policy lets them load", () =>
    Effect.gen(function* () {
      const tailwind = yield* call("/design/vendor/tailwind.js")
      expect(tailwind.status).toBe(200)
      expect(String(tailwind.headers["content-type"])).toContain("javascript")
      expect((yield* call("/design/vendor/daisyui.css")).status).toBe(200)
      expect((yield* call("/design/vendor/nope.js")).status).toBe(404)
      expect((yield* call("/design/vendor/../secret")).status).toBe(404)

      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "styled", { "index.html": "<html></html>" })
      const page = yield* call(`/design/${prototype.id}/files/index.html`)
      expect(String(page.headers["content-security-policy"])).toContain("/design/vendor/")
    }),
  )
})

describe("the passive layout inbox", () => {
  const json = (body: unknown, token: string, method = "POST"): RequestInit => ({
    method,
    headers: { "content-type": "application/json", "x-redcode-design-token": token },
    body: JSON.stringify(body),
  })
  const read = (response: HttpServerResponse.HttpServerResponse) =>
    bodyOf(response).pipe(Effect.map((text) => JSON.parse(text) as Record<string, any>))
  const begin = (id: string, token: string, sequence = 1) =>
    Effect.gen(function* () {
      const response = yield* call(`/design/${id}/loads/begin`, json({ client: "tab-a", sequence }, token))
      expect(response.status).toBe(200)
      return (yield* read(response)) as { revision: number; artifact_load_token: string; status: string }
    })
  const overflow = { selector: "html", kind: "page-horizontal-overflow", axis: "horizontal", overflowPx: 120, severity: "error" }
  const pass = (loadToken: string, revision: number, sequence: number, findings: unknown[], extra: Record<string, unknown> = {}) => ({
    complete: true,
    target_presence_complete: true,
    artifact_revision: revision,
    artifact_load_token: loadToken,
    artifact_pass_sequence: sequence,
    viewport_width: 1440,
    findings,
    ...extra,
  })

  it.instance("a diagnostic pass fills the inbox and never wakes the agent; a stale one changes nothing", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "audit", { "index.html": "<html></html>" })
      delivered.length = 0
      const load = yield* begin(prototype.id, prototype.token)
      expect(load.status).toBe("begun")
      expect(load.artifact_load_token.length).toBeGreaterThan(20)

      // The frame is served under that load; a made-up load is refused rather than served.
      const page = yield* call(`/design/${prototype.id}/files/index.html?load=${load.artifact_load_token}`)
      expect(page.status).toBe(200)
      expect((yield* call(`/design/${prototype.id}/files/index.html?load=nope`)).status).toBe(409)
      const probe = yield* call(`/design/${prototype.id}/files/index.html?load=${load.artifact_load_token}&probe=1`)
      expect(probe.status).toBe(200)

      const recorded = yield* call(
        `/design/${prototype.id}/layout-diagnostics`,
        json(pass(load.artifact_load_token, load.revision, 1, [overflow]), prototype.token),
      )
      expect(recorded.status).toBe(200)
      const body = yield* read(recorded)
      expect(body.status).toBe("recorded")
      expect(body.active_count).toBe(1)
      expect(body.warnings[0]).toMatchObject({ rule: "page-horizontal-overflow", status: "open", viewport_class: "desktop" })
      expect(delivered.length).toBe(0)

      // A replay of the same pass, and a pass under a token nobody issued, are both stale.
      const replay = yield* read(
        yield* call(`/design/${prototype.id}/layout-diagnostics`, json(pass(load.artifact_load_token, load.revision, 1, []), prototype.token)),
      )
      expect(replay.status).toBe("stale")
      const forged = yield* read(
        yield* call(`/design/${prototype.id}/layout-diagnostics`, json(pass("forged", load.revision, 9, []), prototype.token)),
      )
      expect(forged.status).toBe("stale")
      expect(forged.active_count).toBe(1)

      // It survives a restart of the registry's memory: the sidecar has it.
      const listed = yield* read(
        yield* call(`/design/${prototype.id}/layout-warnings`, { headers: { "x-redcode-design-token": prototype.token } }),
      )
      expect(listed.warnings.length).toBe(1)
      expect(listed.revision).toBe(load.revision)
      const registry = yield* DesignRegistry.Service
      expect((yield* registry.get(prototype.id))!.warnings.length).toBe(1)
      expect((yield* call(`/design/${prototype.id}/layout-warnings`)).status).toBe(403)
    }),
  )

  it.instance("queueing prepares one ordinary note, refuses a moved revision, and commits on delivery", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "queue", { "index.html": "<html></html>" })
      delivered.length = 0
      const load = yield* begin(prototype.id, prototype.token)
      yield* call(
        `/design/${prototype.id}/layout-diagnostics`,
        json(pass(load.artifact_load_token, load.revision, 1, [overflow]), prototype.token),
      )
      const listed = yield* read(
        yield* call(`/design/${prototype.id}/layout-warnings`, { headers: { "x-redcode-design-token": prototype.token } }),
      )
      const id = listed.warnings[0].id as string

      const moved = yield* call(
        `/design/${prototype.id}/layout-warnings/queue`,
        json({ ids: [id], revision: load.revision + 5 }, prototype.token),
      )
      expect(moved.status).toBe(409)
      expect((yield* read(moved)).revision).toBe(load.revision)

      const prepared = yield* read(
        yield* call(`/design/${prototype.id}/layout-warnings/queue`, json({ ids: [id], revision: load.revision }, prototype.token)),
      )
      expect(prepared.status).toBe("prepared")
      expect(prepared.queued_count).toBe(1)
      expect(prepared.prompt.prompt).toContain("Fix this layout issue")
      expect(prepared.prompt.target.type).toBe("layout-warnings")
      // Prepared is not committed: the inbox still offers it until the note is delivered.
      expect(prepared.warnings[0].status).toBe("open")

      const sent = yield* call(
        `/design/${prototype.id}/feedback`,
        json(
          { items: [{ tag: "layout-warnings", text: prepared.prompt.prompt, target: prepared.prompt.target }] },
          prototype.token,
        ),
      )
      expect(sent.status).toBe(202)
      expect(delivered.length).toBe(1)
      expect(delivered[0]!.text).toContain("[layout issues: 1 queued for repair]")
      expect(delivered[0]!.text).toContain("Fix this layout issue")
      const registry = yield* DesignRegistry.Service
      const after = (yield* registry.get(prototype.id))!.warnings[0]!
      expect(after.status).toBe("queued")
      expect(after.queue_attempts).toBe(1)

      // Queued is outstanding: it can be neither re-queued nor dismissed.
      const again = yield* read(
        yield* call(`/design/${prototype.id}/layout-warnings/queue`, json({ ids: [id] }, prototype.token)),
      )
      expect(again.status).toBe("unchanged")
      const dismissed = yield* read(
        yield* call(`/design/${prototype.id}/layout-warnings/dismiss`, json({ id }, prototype.token)),
      )
      expect(dismissed.status).toBe("unchanged")
    }),
  )

  it.instance("dismissing hides a warning for this revision only", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "dismiss", { "index.html": "<html></html>" })
      const load = yield* begin(prototype.id, prototype.token)
      yield* call(
        `/design/${prototype.id}/layout-diagnostics`,
        json(pass(load.artifact_load_token, load.revision, 1, [overflow]), prototype.token),
      )
      const registry = yield* DesignRegistry.Service
      const id = (yield* registry.get(prototype.id))!.warnings[0]!.id
      const dismissed = yield* read(
        yield* call(`/design/${prototype.id}/layout-warnings/dismiss`, json({ id }, prototype.token)),
      )
      expect(dismissed.status).toBe("dismissed")
      expect(dismissed.warnings[0].active).toBe(false)

      // A newer revision that still has it brings it back.
      yield* registry.bump(prototype.id)
      const next = yield* begin(prototype.id, prototype.token, 2)
      expect(next.revision).toBe(load.revision + 1)
      const back = yield* read(
        yield* call(
          `/design/${prototype.id}/layout-diagnostics`,
          json(pass(next.artifact_load_token, next.revision, 1, [overflow]), prototype.token),
        ),
      )
      expect(back.warnings[0].status).toBe("open")
    }),
  )

  it.instance("a failure to show the prototype is the one report that reaches the agent, once per load", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "broken", { "index.html": "<html></html>" })
      delivered.length = 0
      const load = yield* begin(prototype.id, prototype.token)
      const failure = {
        failures: [
          { kind: "artifact-asset-unavailable", detail: "<img> could not load /design/x/files/hero.png" },
          { kind: "made-up", detail: "ignored" },
        ],
        artifact_load_token: load.artifact_load_token,
        artifact_revision: load.revision,
      }
      const first = yield* call(`/design/${prototype.id}/artifact-failures`, json(failure, prototype.token))
      expect(first.status).toBe(200)
      expect((yield* read(first)).status).toBe("recorded")
      expect(delivered.length).toBe(1)
      expect(delivered[0]!.text).toContain("<artifact-failures")
      expect(delivered[0]!.text).toContain("hero.png")
      expect(delivered[0]!.text).not.toContain("made-up")

      const repeat = yield* read(yield* call(`/design/${prototype.id}/artifact-failures`, json(failure, prototype.token)))
      expect(repeat.status).toBe("unchanged")
      expect(delivered.length).toBe(1)

      const stale = yield* call(
        `/design/${prototype.id}/artifact-failures`,
        json({ ...failure, artifact_load_token: "old" }, prototype.token),
      )
      expect(stale.status).toBe(409)
      expect(delivered.length).toBe(1)
    }),
  )

  it.instance("the event stream tells a shell the inbox as it opens, and again when it changes", () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const prototype = yield* prototypeIn(directory, "inbox-live", { "index.html": "<html></html>" })
      const load = yield* begin(prototype.id, prototype.token)
      yield* call(
        `/design/${prototype.id}/layout-diagnostics`,
        json(pass(load.artifact_load_token, load.revision, 1, [overflow]), prototype.token),
      )
      const stream = yield* call(`/design/${prototype.id}/events?token=${prototype.token}`)
      const body = yield* Effect.scoped(
        Effect.gen(function* () {
          const web = HttpServerResponse.toWeb(stream)
          const reader = web.body!.getReader()
          let text = ""
          while (!text.includes("event: layout-warnings")) {
            const chunk = yield* Effect.promise(() => reader.read())
            if (chunk.done) break
            text += new TextDecoder().decode(chunk.value)
          }
          yield* Effect.promise(() => reader.cancel())
          return text
        }),
      )
      expect(body).toContain("event: layout-warnings")
      expect(body).toContain("page-horizontal-overflow")
    }),
  )
})
