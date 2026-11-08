import { Database as Sqlite } from "bun:sqlite"
import { createHash } from "node:crypto"
import path from "node:path"
import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const raw = Buffer.from("same attachment bytes")
const base64 = raw.toString("base64")
const hash = createHash("sha256").update(raw).digest("hex")

it.live("deduplicates projected attachments while preserving inline reads and serving immutable media", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("redcode-media-")).path
    const database = path.join(directory, "redcode.db")
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: database },
      config: { directory, project: false, global: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const headers = { "content-type": "application/json", "x-opencode-directory": encodeURIComponent(directory) }
    const created = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers,
          body: JSON.stringify({ location: { directory } }),
        }),
      ),
    )
    expect(created.status).toBe(200)
    const template = (yield* Effect.promise(() => created.json()) as { data: Record<string, unknown> }).data
    const sessionID = Session.ID.create()
    const messages = [1, 2].map((index) => ({
      id: SessionMessage.ID.create(),
      type: "user",
      text: `attachment ${index}`,
      files: [{ data: base64, mime: "text/plain", source: { type: "inline" }, name: "note.txt" }],
      time: { created: Date.now() + index },
    }))
    const imported = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/experimental/session/import", {
          method: "POST",
          headers,
          body: JSON.stringify({ info: { ...template, id: sessionID }, messages, location: { directory } }),
        }),
      ),
    )
    expect(imported.status).toBe(200)

    const listed = yield* Effect.promise(() =>
      handler(new Request(`http://opencode.local/api/session/${sessionID}/message?order=asc`, { headers })),
    )
    expect(listed.status).toBe(200)
    expect((yield* Effect.promise(() => listed.json()) as { data: unknown[] }).data).toMatchObject(messages)

    const referenced = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/session/${sessionID}/message?order=asc`, {
          headers: { ...headers, "x-opencode-capabilities": "experimental-media-uri" },
        }),
      ),
    )
    expect(referenced.status).toBe(200)
    const referencedMessages = (yield* Effect.promise(() => referenced.json()) as {
      data: Array<{ id: string; files: Array<Record<string, unknown>> }>
    }).data
    expect(referencedMessages).toMatchObject(
      messages.map((message) => ({
        id: message.id,
        files: [{ uri: `media:${hash}`, bytes: raw.byteLength, mime: "text/plain" }],
      })),
    )
    expect(referencedMessages[0]!.files[0]).not.toHaveProperty("data")

    const single = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/session/${sessionID}/message/${messages[0]!.id}`, {
          headers: { ...headers, "x-opencode-capabilities": "experimental-media-uri" },
        }),
      ),
    )
    expect(single.status).toBe(200)
    expect((yield* Effect.promise(() => single.json()) as { data: unknown }).data).toMatchObject({
      id: messages[0]!.id,
      files: [{ uri: `media:${hash}`, bytes: raw.byteLength }],
    })

    const db = new Sqlite(database)
    expect(db.query("SELECT count(*) AS total FROM blob").get()).toEqual({ total: 1 })
    expect(db.query("SELECT count(*) AS total FROM blob_ref").get()).toEqual({ total: 2 })
    db.close()

    const media = yield* Effect.promise(() =>
      handler(new Request(`http://opencode.local/api/experimental/media/${hash}`, { headers })),
    )
    expect(media.status).toBe(200)
    expect(media.headers.get("content-type")).toBe("application/octet-stream")
    expect(media.headers.get("content-disposition")).toBe("attachment")
    expect(media.headers.get("content-security-policy")).toBe(
      "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
    )
    expect(media.headers.get("x-content-type-options")).toBe("nosniff")
    expect(media.headers.get("cache-control")).toBe("private, max-age=31536000, immutable")
    expect(media.headers.get("etag")).toBe(`"${hash}"`)
    expect(Buffer.from(yield* Effect.promise(() => media.arrayBuffer()))).toEqual(raw)

    const cached = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/experimental/media/${hash}`, {
          headers: { ...headers, "if-none-match": `W/"${hash}"` },
        }),
      ),
    )
    expect(cached.status).toBe(304)
    expect((yield* Effect.promise(() => cached.arrayBuffer())).byteLength).toBe(0)

    const forked = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/session/${sessionID}/fork`, {
          method: "POST",
          headers,
          body: "{}",
        }),
      ),
    )
    expect(forked.status).toBe(200)
    const childID = (yield* Effect.promise(() => forked.json()) as { data: { id: string } }).data.id
    const afterFork = new Sqlite(database)
    expect(afterFork.query("SELECT count(*) AS total FROM blob").get()).toEqual({ total: 1 })
    expect(afterFork.query("SELECT count(*) AS total FROM blob_ref").get()).toEqual({ total: 4 })
    afterFork.close()

    const remove = (id: string) =>
      handler(new Request(`http://opencode.local/api/session/${id}`, { method: "DELETE", headers }))
    expect((yield* Effect.promise(() => remove(sessionID))).status).toBe(204)
    expect(
      (yield* Effect.promise(() =>
        handler(new Request(`http://opencode.local/api/experimental/media/${hash}`, { headers })),
      )).status,
    ).toBe(200)
    expect((yield* Effect.promise(() => remove(childID))).status).toBe(204)
    expect(
      (yield* Effect.promise(() =>
        handler(new Request(`http://opencode.local/api/experimental/media/${hash}`, { headers })),
      )).status,
    ).toBe(404)
    const afterDelete = new Sqlite(database)
    expect(afterDelete.query("SELECT count(*) AS total FROM blob").get()).toEqual({ total: 0 })
    expect(afterDelete.query("SELECT count(*) AS total FROM blob_ref").get()).toEqual({ total: 0 })
    afterDelete.close()
  }).pipe(Effect.scoped),
)
