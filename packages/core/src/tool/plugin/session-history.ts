export * as SessionHistoryTool from "./session-history.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import type { SessionMessage } from "../../session/message.js"

export const name = "session_history"
const PAGE = 50
const MAX_MATCHES = 20
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Keywords to find in messages outside the current session context" }),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_MATCHES }))),
})

/** Search the durable transcript while returning only messages outside the active model context. */
export const Plugin = {
  id: "opencode.tool.session-history",
  effect: Effect.fn("SessionHistoryTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Search messages removed from the current model context by compaction. Use keywords from the earlier conversation. Returns short excerpts with durable message IDs.",
          input: Input,
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              const terms = [...new Set(input.query.trim().split(/\s+/u).filter(Boolean))]
              if (terms.length === 0) return yield* Effect.fail(new Error("Provide keywords to search"))
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const visible = new Set((yield* sessions.context(context.sessionID)).map((message) => message.id))
              const matches: { id: string; type: string; score: number; excerpt: string }[] = []
              let cursor: SessionMessage.ID | undefined
              while (true) {
                const page = yield* sessions.messages({
                  sessionID: context.sessionID,
                  limit: PAGE,
                  order: "desc",
                  ...(cursor === undefined ? {} : { cursor: { id: cursor, direction: "next" } }),
                })
                if (page.length === 0) break
                for (const message of page) {
                  if (visible.has(message.id)) continue
                  const body =
                    message.type === "assistant"
                      ? message.content
                          .flatMap((part) => {
                            if (part.type === "text" || part.type === "reasoning") return [part.text]
                            if (part.state.status === "completed")
                              return [
                                `${part.name}(${JSON.stringify(part.state.input)})`,
                                ...part.state.content.filter((item) => item.type === "text").map((item) => item.text),
                              ]
                            return [`${part.name}(${JSON.stringify(part.state.input)})`]
                          })
                          .join("\n")
                      : message.type === "user" || message.type === "synthetic" || message.type === "system"
                        ? message.text
                        : ""
                  const hits = terms.flatMap((term) => {
                    const at = new RegExp(escape(term), "iu").exec(body)?.index
                    return at === undefined ? [] : [at]
                  })
                  if (hits.length === 0) continue
                  const start = Math.max(0, Math.min(...hits) - 150)
                  matches.push({
                    id: message.id,
                    type: message.type,
                    score: hits.length,
                    excerpt: [
                      start > 0 ? "…" : "",
                      body.slice(start, start + 300).replace(/\s+/gu, " ").trim(),
                      start + 300 < body.length ? "…" : "",
                    ].join(""),
                  })
                }
                if (page.length < PAGE) break
                cursor = page[page.length - 1]!.id
              }
              const lines = matches
                .toSorted((a, b) => b.score - a.score)
                .slice(0, input.limit ?? 5)
                .map((item) => `<message id="${item.id}" type="${item.type}">\n${item.excerpt}\n</message>`)
              const result = lines.join("\n\n") || "No compacted message matches those keywords."
              return { output: result, content: result, metadata: { matches: lines.length } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Session history search failed", error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
