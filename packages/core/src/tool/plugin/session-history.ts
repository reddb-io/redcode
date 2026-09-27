export * as SessionHistoryTool from "./session-history.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionMessage } from "../../session/message.js"

export const name = "session_history"
const PAGE = 50
const MAX_MATCHES = 20
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

export const Input = Schema.Struct({
  query: Schema.optionalKey(Schema.String.annotate({ description: "Keywords to find in messages outside the current session context" })),
  messageID: Schema.optionalKey(SessionMessage.ID.annotate({ description: "Exact message ID from a trimmed tool output" })),
  toolCallID: Schema.optionalKey(Schema.String.annotate({ description: "Exact tool call ID from a trimmed tool output" })),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_MATCHES }))),
})

/** Search older history or retrieve a trimmed output by its durable IDs. */
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
            "Search messages removed by compaction, or retrieve a trimmed tool output using its messageID and toolCallID. Keyword search returns short excerpts with durable message IDs.",
          input: Input,
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              const terms = [...new Set((input.query ?? "").trim().split(/\s+/u).filter(Boolean))]
              if (input.toolCallID !== undefined && input.messageID === undefined)
                return yield* Effect.fail(new Error("Provide messageID with toolCallID"))
              if (input.messageID === undefined && terms.length === 0)
                return yield* Effect.fail(new Error("Provide keywords to search or a messageID"))
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              if (input.messageID !== undefined) {
                const message = yield* sessions.message({ sessionID: context.sessionID, messageID: input.messageID })
                if (message?.type !== "assistant") return yield* Effect.fail(new Error("Assistant message not found"))
                const tools = message.content.filter((part) => part.type === "tool").filter((part) => part.state.status === "completed")
                const selected = input.toolCallID === undefined ? tools : tools.filter((part) => part.id === input.toolCallID)
                if (selected.length === 0) return yield* Effect.fail(new Error("Completed tool output not found"))
                const result = selected
                  .flatMap((part) =>
                    part.state.status === "completed"
                      ? part.state.content.filter((item) => item.type === "text").map((item) => item.text)
                      : [],
                  )
                  .join("\n")
                return { output: result, content: result, metadata: { matches: selected.length } }
              }
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
                            if (part.type === "tool" && part.state.status === "completed")
                              return [
                                `${part.name}(${JSON.stringify(part.state.input)})`,
                                ...part.state.content.filter((item) => item.type === "text").map((item) => item.text),
                              ]
                            return part.type === "tool" ? [`${part.name}(${JSON.stringify(part.state.input)})`] : []
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
