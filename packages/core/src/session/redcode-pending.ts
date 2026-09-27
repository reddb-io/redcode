export * as RedcodePending from "./redcode-pending.js"

import { asc, eq, isNull } from "drizzle-orm"
import { Effect, Schema } from "effect"
import path from "node:path"
import { readdir, readFile, stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Database } from "../database/database.js"
import { KVTable } from "../kv/sql.js"
import { SessionInbox } from "./inbox.js"
import { SessionMessage } from "./message.js"
import { RedcodeSessionInputTable } from "./redcode-legacy.sql.js"
import { SessionSchema } from "./schema.js"

const Mention = Schema.Struct({ start: Schema.Finite, end: Schema.Finite, text: Schema.String })
const LegacyPrompt = Schema.Struct({
  text: Schema.String,
  files: Schema.optional(
    Schema.Array(
      Schema.Struct({
        uri: Schema.String,
        mime: Schema.String,
        name: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
        source: Schema.optional(Mention),
      }),
    ),
  ),
  agents: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, source: Schema.optional(Mention) }))),
})
type LegacyFile = NonNullable<(typeof LegacyPrompt.Type)["files"]>[number]
const MaxAttachmentBytes = 20 * 1024 * 1024

/** Admit still-pending V1 inputs through the normal V2 event and projection path. */
export const admit = Effect.fn("RedcodePending.admit")(function* () {
  const db = (yield* Database.Service).db
  const inbox = yield* SessionInbox.make()
  const pending = yield* db
    .select()
    .from(RedcodeSessionInputTable)
    .where(isNull(RedcodeSessionInputTable.promoted_seq))
    .orderBy(asc(RedcodeSessionInputTable.session_id), asc(RedcodeSessionInputTable.admitted_seq))
    .all()
  yield* Effect.forEach(
    pending,
    (row) =>
      Effect.gen(function* () {
        // Keep the source staging row unchanged so a repeated import can compare it.
        const key = `redcode.pending.admitted:${row.id}`
        if (yield* db.select({ key: KVTable.key }).from(KVTable).where(eq(KVTable.key, key)).get()) return
        const prompt = yield* Schema.decodeUnknownEffect(LegacyPrompt)(row.prompt)
        if (row.delivery !== "queue" && row.delivery !== "steer")
          return yield* Effect.fail(new Error(`Pending Redcode input ${row.id} has unknown delivery ${row.delivery}`))
        const base = { id: SessionMessage.ID.make(row.id), sessionID: SessionSchema.ID.make(row.session_id) }
        const type = row.id.startsWith("msg_monitor_") ? "synthetic" : "user"
        const mark = () =>
          db.insert(KVTable).values({ key, value: true }).onConflictDoNothing().run().pipe(Effect.orDie, Effect.asVoid)
        // Earlier imports may already have admitted this ID. Reconcile before reading a file
        // attachment that may have disappeared since the first successful admission.
        if (yield* inbox.reconcile({ ...base, type, delivery: row.delivery })) {
          yield* mark()
          return
        }
        // V1 stored only Prompt in the inbox; monitor continuation IDs retain its synthetic origin.
        if (type === "synthetic") {
          if (prompt.files?.length || prompt.agents?.length)
            return yield* Effect.fail(new Error(`Synthetic Redcode input ${row.id} has attachments`))
          return yield* inbox.admit({
            ...base,
            item: { type: "synthetic", payload: { text: prompt.text }, delivery: row.delivery },
            commit: mark,
          })
        }
        const files = yield* Effect.forEach(prompt.files ?? [], (file) => materialize(file, row.id))
        return yield* inbox.admit({
          ...base,
          commit: mark,
          item: {
            type: "user",
            payload: {
              text: prompt.text,
              ...(files.length ? { files } : {}),
              ...(prompt.agents?.length
                ? {
                    agents: prompt.agents.map((agent) => ({
                      name: agent.name,
                      ...(agent.source === undefined ? {} : { mention: agent.source }),
                    })),
                  }
                : {}),
            },
            delivery: row.delivery,
          },
        })
      }),
    { discard: true },
  )
  return [...new Set(pending.map((row) => SessionSchema.ID.make(row.session_id)))]
})

function materialize(file: LegacyFile, inputID: string) {
  return Effect.gen(function* () {
    const label = file.name ?? (file.uri.startsWith("data:") ? "inline attachment" : file.uri)
    if (file.uri.startsWith("data:")) {
      const comma = file.uri.indexOf(",")
      if (comma < 0)
        return yield* Effect.fail(new Error(`Pending Redcode input ${inputID} has an invalid ${label} data URL`))
      const metadata = file.uri.slice(5, comma)
      const bytes = yield* Effect.try({
        try: () => {
          const payload = file.uri.slice(comma + 1)
          if (!metadata.split(";").some((part) => part.toLowerCase() === "base64"))
            return Buffer.from(decodeURIComponent(payload))
          const decoded = Buffer.from(payload, "base64")
          if (decoded.toString("base64") !== payload) throw new Error("Non-canonical base64")
          return decoded
        },
        catch: () => new Error(`Pending Redcode input ${inputID} has an invalid ${label} data URL`),
      })
      if (bytes.byteLength > MaxAttachmentBytes)
        return yield* Effect.fail(new Error(`Pending Redcode input ${inputID} attachment exceeds 20 MiB: ${label}`))
      return {
        data: bytes.toString("base64"),
        mime: file.mime,
        source: { type: "inline" as const },
        ...(file.name === undefined ? {} : { name: file.name }),
        ...(file.description === undefined ? {} : { description: file.description }),
        ...(file.source === undefined ? {} : { mention: file.source }),
      }
    }
    const url = yield* Effect.try({
      try: () => new URL(file.uri),
      catch: () => new Error(`Pending Redcode input ${inputID} has an invalid attachment URI: ${label}`),
    })
    if (url.protocol !== "file:")
      return yield* Effect.fail(
        new Error(`Pending Redcode input ${inputID} has an unsupported attachment URI: ${label}`),
      )
    const start = positiveInt(url.searchParams.get("start"))
    const end = positiveInt(url.searchParams.get("end"))
    url.search = ""
    url.hash = ""
    const target = yield* Effect.try({
      try: () => fileURLToPath(url),
      catch: () => new Error(`Pending Redcode input ${inputID} has an invalid file URI: ${label}`),
    })
    const info = yield* Effect.tryPromise({
      try: () => stat(target),
      catch: () => new Error(`Pending Redcode input ${inputID} cannot read attachment: ${label}`),
    })
    if (!info.isFile() && !info.isDirectory())
      return yield* Effect.fail(new Error(`Pending Redcode input ${inputID} attachment is not a file: ${label}`))
    if (info.isFile() && info.size > MaxAttachmentBytes)
      return yield* Effect.fail(new Error(`Pending Redcode input ${inputID} attachment exceeds 20 MiB: ${label}`))
    const bytes = yield* Effect.tryPromise({
      try: () =>
        info.isDirectory()
          ? readdir(target, { withFileTypes: true }).then((entries) =>
              Buffer.from(
                entries
                  .filter((entry) => entry.isFile() || entry.isDirectory())
                  .sort((a, b) =>
                    a.isDirectory() === b.isDirectory()
                      ? a.name.localeCompare(b.name)
                      : a.isDirectory()
                        ? -1
                        : 1,
                  )
                  .map((entry) => entry.name + (entry.isDirectory() ? path.sep : ""))
                  .join("\n"),
              ),
            )
          : readFile(target),
      catch: () => new Error(`Pending Redcode input ${inputID} cannot read attachment: ${label}`),
    })
    const content =
      file.mime === "text/plain" && start !== undefined
        ? Buffer.from(bytes.toString("utf8").split("\n").slice(start - 1, end).join("\n"))
        : bytes
    if (content.byteLength > MaxAttachmentBytes)
      return yield* Effect.fail(new Error(`Pending Redcode input ${inputID} attachment exceeds 20 MiB: ${label}`))
    return {
      data: content.toString("base64"),
      mime: info.isDirectory() ? "application/x-directory" : file.mime,
      source: { type: "uri" as const, uri: file.uri },
      name: file.name ?? path.basename(target),
      ...(file.description === undefined ? {} : { description: file.description }),
      ...(file.source === undefined ? {} : { mention: file.source }),
    }
  })
}

function positiveInt(value: string | null) {
  if (value === null) return
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}
