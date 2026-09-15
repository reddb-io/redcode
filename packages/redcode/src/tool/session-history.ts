import { Database } from "@reddb-io/redcode-core/database/database"
import type { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { Effect, Schema } from "effect"
import { MessageV2 } from "../session/message-v2"
import type { SessionID } from "../session/schema"
import { Token } from "@/util/token"
import * as Tool from "./tool"
import DESCRIPTION from "./session-history.txt"

export const ID = "session_history"
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 20
const EXCERPT_CHARS = 300
const MAX_OUTPUT_TOKENS = 4_000

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Keywords to look for in the compacted-away messages" }),
  limit: Schema.optional(Schema.Number).annotate({
    description: `Maximum matches to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT})`,
  }),
})

type Metadata = { matches: number; hidden: number }

/** The searchable text of a message: what the person wrote, what the model wrote, and its tool calls. */
export function text(message: SessionV1.WithParts) {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return part.text ? [part.text] : []
      if (part.type === "reasoning") return part.text ? [part.text] : []
      if (part.type === "file") return [`[Attached ${part.mime}: ${part.filename ?? "file"}]`]
      if (part.type !== "tool") return []
      const call = `${part.tool}(${JSON.stringify(part.state.input)})`
      if (part.state.status === "completed") return [call, part.state.output]
      if (part.state.status === "error") return [call, part.state.error]
      return [call]
    })
    .join("\n")
}

function terms(query: string) {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))]
}

function excerpt(body: string, at: number) {
  const start = Math.max(0, at - Math.floor(EXCERPT_CHARS / 2))
  const end = Math.min(body.length, start + EXCERPT_CHARS)
  return `${start > 0 ? "…" : ""}${body.slice(start, end).replace(/\s+/g, " ").trim()}${end < body.length ? "…" : ""}`
}

/**
 * Ranks the messages compaction removed from the model's context against the keywords: more
 * distinct terms first, then the newest. Pure, so the ranking is testable without a session.
 */
export function search(
  all: readonly SessionV1.WithParts[],
  visible: readonly SessionV1.WithParts[],
  query: string,
  limit = DEFAULT_LIMIT,
) {
  const shown = new Set(visible.map((message) => message.info.id))
  const hidden = all.filter((message) => !shown.has(message.info.id))
  const words = terms(query)
  const matches = hidden
    .map((message) => {
      const body = text(message)
      const lower = body.toLowerCase()
      const hits = words.map((word) => lower.indexOf(word)).filter((index) => index >= 0)
      return { message, body, score: hits.length, first: hits.length ? Math.min(...hits) : -1 }
    })
    .filter((item) => item.score > 0)
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        b.message.info.time.created - a.message.info.time.created ||
        (b.message.info.id > a.message.info.id ? 1 : -1),
    )
    .slice(0, Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit))))
  return { hidden: hidden.length, matches }
}

export const SessionHistoryTool = Tool.define<typeof Parameters, Metadata, Database.Service>(
  ID,
  Effect.gen(function* () {
    const database = yield* Database.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: ID, patterns: ["*"], always: ["*"], metadata: {} })
          const query = params.query.trim()
          if (!query) throw new Error("Provide query: keywords to look for.")
          // Only this session's rows: the id comes from the tool context, never from the model.
          const sessionID: SessionID = ctx.sessionID
          const all = yield* MessageV2.stream(sessionID).pipe(Effect.provideService(Database.Service, database))
          const visible = MessageV2.filterCompacted(all)
          const result = search(all, visible, query, params.limit ?? DEFAULT_LIMIT)
          const metadata = { matches: result.matches.length, hidden: result.hidden }
          if (result.hidden === 0)
            return {
              title: `History: ${query}`,
              output: "Nothing in this session has been compacted away yet; every message is still in context.",
              metadata,
            }
          if (result.matches.length === 0)
            return {
              title: `History: ${query}`,
              output: `No compacted-away message matches "${query}" (${result.hidden} messages searched).`,
              metadata,
            }
          const lines: string[] = []
          let used = 0
          for (const item of result.matches) {
            const entry = [
              `<message id="${item.message.info.id}" role="${item.message.info.role}" time="${new Date(item.message.info.time.created).toISOString()}">`,
              excerpt(item.body, item.first),
              "</message>",
            ].join("\n")
            const cost = Token.estimate(entry)
            if (used + cost > MAX_OUTPUT_TOKENS) break
            used += cost
            lines.push(entry)
          }
          return {
            title: `History: ${query}`,
            output: [
              `${lines.length} of ${result.hidden} compacted-away messages match "${query}":`,
              ...lines,
            ].join("\n\n"),
            metadata: { ...metadata, matches: lines.length },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
