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
export const MAX_OUTPUT_TOKENS = 4_000
const PAGE = 50

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Keywords to look for in the compacted-away messages" }),
  limit: Schema.optional(Schema.Number).annotate({
    description: `Maximum matches to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT})`,
  }),
})

type Metadata = { matches: number; searched: number }

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

/** Only the tool outputs trimmed from a message the model still sees: the rest is in its context. */
export function trimmedText(message: SessionV1.WithParts) {
  return message.parts
    .flatMap((part) =>
      part.type === "tool" && part.state.status === "completed" && part.state.time.compacted
        ? [`${part.tool}(${JSON.stringify(part.state.input)})`, part.state.output]
        : [],
    )
    .join("\n")
}

function terms(query: string) {
  return [...new Set(query.split(/\s+/u).filter(Boolean))]
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

/**
 * Where each term first appears, case-insensitively, as offsets into the original text: matching
 * on a lowercased copy would shift offsets wherever case mapping changes a string's length.
 */
function offsets(body: string, words: readonly string[]) {
  return words.flatMap((word) => {
    const index = new RegExp(escape(word), "iu").exec(body)?.index
    return index === undefined ? [] : [index]
  })
}

function excerpt(body: string, at: number) {
  const start = Math.max(0, at - Math.floor(EXCERPT_CHARS / 2))
  const end = Math.min(body.length, start + EXCERPT_CHARS)
  return `${start > 0 ? "…" : ""}${body.slice(start, end).replace(/\s+/gu, " ").trim()}${end < body.length ? "…" : ""}`
}

export type Match = { message: SessionV1.WithParts; body: string; score: number; first: number }

/** Scores one message; `trimmedOnly` searches just its trimmed tool outputs. */
export function score(message: SessionV1.WithParts, query: string, trimmedOnly = false): Match | undefined {
  const body = trimmedOnly ? trimmedText(message) : text(message)
  if (!body) return
  const hits = offsets(body, terms(query))
  if (hits.length === 0) return
  return { message, body, score: hits.length, first: Math.min(...hits) }
}

/** More distinct terms first, then the newest. */
export function rank(matches: readonly Match[], limit = DEFAULT_LIMIT) {
  return matches
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        b.message.info.time.created - a.message.info.time.created ||
        (b.message.info.id > a.message.info.id ? 1 : -1),
    )
    .slice(0, Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit))))
}

/** The tool output: excerpts with message ids, cut off before `maxTokens`. */
export function render(matches: readonly Match[], maxTokens = MAX_OUTPUT_TOKENS) {
  const lines: string[] = []
  let used = 0
  for (const item of matches) {
    const entry = [
      `<message id="${item.message.info.id}" role="${item.message.info.role}" time="${new Date(item.message.info.time.created).toISOString()}">`,
      excerpt(item.body, item.first),
      "</message>",
    ].join("\n")
    const cost = Token.estimate(entry)
    if (used + cost > maxTokens) break
    used += cost
    lines.push(entry)
  }
  return lines
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
          const limit = params.limit ?? DEFAULT_LIMIT
          const words = terms(query)
          // Only this session's rows: the id comes from the tool context, never from the model.
          const sessionID: SessionID = ctx.sessionID
          const provide = Effect.provideService(Database.Service, database)
          const shown = new Set((yield* MessageV2.filterCompactedEffect(sessionID).pipe(provide)).map((m) => m.info.id))
          // Newest first, a page at a time, stopping once enough messages match every term.
          const matches: Match[] = []
          let searched = 0
          let before: string | undefined
          while (true) {
            const page = yield* MessageV2.page({ sessionID, limit: PAGE, before }).pipe(
              provide,
              Effect.catch(() => Effect.succeed({ items: [] as SessionV1.WithParts[], more: false, cursor: undefined })),
            )
            for (const message of [...page.items].reverse()) {
              const visible = shown.has(message.info.id)
              if (!visible) searched++
              const found = score(message, query, visible)
              if (found) matches.push(found)
            }
            if (matches.filter((item) => item.score === words.length).length >= limit) break
            if (!page.more || !page.cursor) break
            before = page.cursor
          }
          const ranked = rank(matches, limit)
          const title = `History: ${query}`
          if (ranked.length === 0)
            return {
              title,
              output:
                searched === 0 && matches.length === 0
                  ? `Nothing matches "${query}": no message has been compacted away and no tool output has been trimmed yet.`
                  : `No compacted-away message or trimmed tool output matches "${query}".`,
              metadata: { matches: 0, searched },
            }
          const lines = render(ranked)
          return {
            title,
            output: [`${lines.length} matches for "${query}" in compacted-away messages and trimmed tool output:`, ...lines].join(
              "\n\n",
            ),
            metadata: { matches: lines.length, searched },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
