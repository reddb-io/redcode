export * as SessionTaskFacts from "./task-facts"

import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { MessageTable, PartTable, SessionMessageTable } from "./sql"
import { SessionV1 } from "../v1/session"

export type Result = {
  callID: string
  messageID: string
  tool: string
  hash: string
  completed: number
  successful: boolean
  mutation: boolean
  settled: boolean
  summary: string
}
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex")
const mutations = new Set(["write", "edit", "apply_patch", "multiedit", "bash", "shell"])
const bookkeeping = new Set(["todowrite", "todoread", "plan_exit", "goal_status", "goal_complete"])

const make = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const load = Effect.fn("SessionTaskFacts.load")(function* (sessionID: SessionSchema.ID) {
    const rows = yield* db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, sessionID))
      .all()
      .pipe(Effect.orDie)
    const messages = rows.map((row) =>
      Schema.decodeUnknownSync(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }),
    )
    const requests = messages.flatMap((message) =>
      message.type === "user"
        ? [{ id: message.id, text: message.text, created: DateTime.toEpochMillis(message.time.created) }]
        : [],
    )
    const results: Result[] = messages.flatMap((message) =>
      message.type === "assistant"
        ? message.content.flatMap((part) => {
            if (part.type !== "tool") return []
            return [
              {
                callID: part.id,
                messageID: message.id,
                tool: part.name,
                hash: hash(part.state),
                completed: DateTime.toEpochMillis(part.time.completed ?? part.time.ran ?? part.time.created),
                successful: part.state.status === "completed" && success(part.name, part.state.structured),
                mutation: mutations.has(part.name),
                settled: part.state.status === "completed" || part.state.status === "error",
                summary: JSON.stringify({
                  input: part.state.input,
                  status: part.state.status,
                  output:
                    part.state.status === "completed"
                      ? part.state.content.filter((item) => item.type === "text")
                      : undefined,
                }).slice(0, 1000),
              },
            ]
          })
        : [],
    )
    if (rows.length) return { requests, results }
    const legacy = yield* db
      .select()
      .from(MessageTable)
      .where(eq(MessageTable.session_id, sessionID))
      .all()
      .pipe(Effect.orDie)
    const parts = (yield* db
      .select()
      .from(PartTable)
      .where(eq(PartTable.session_id, sessionID))
      .all()
      .pipe(Effect.orDie)).map((row) =>
      Schema.decodeUnknownSync(SessionV1.Part)({ ...row.data, id: row.id, sessionID, messageID: row.message_id }),
    )
    const assistants = new Set(legacy.filter((row) => row.data.role === "assistant").map((row) => row.id))
    return {
      requests: legacy.flatMap((row) => {
        if (row.data.role !== "user") return []
        const text = parts
          .flatMap((part) =>
            part.messageID === row.id && part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : [],
          )
          .join("\n")
        return text ? [{ id: row.id, text, created: row.data.time.created }] : []
      }),
      results: parts.flatMap((part): Result[] => {
        if (part.type !== "tool" || !assistants.has(part.messageID)) return []
        return [
          {
            callID: part.callID,
            messageID: part.messageID,
            tool: part.tool,
            hash: hash(
              part.state.status === "completed"
                ? {
                    status: part.state.status,
                    input: part.state.input,
                    output: part.state.output,
                    metadata: part.state.metadata,
                  }
                : part.state,
            ),
            completed:
              part.state.status === "pending"
                ? 0
                : "end" in part.state.time
                  ? part.state.time.end
                  : part.state.time.start,
            successful: part.state.status === "completed" && success(part.tool, part.state.metadata),
            mutation: mutations.has(part.tool),
            settled: part.state.status === "completed" || part.state.status === "error",
            summary: JSON.stringify({
              input: part.state.input,
              status: part.state.status,
              output: part.state.status === "completed" ? part.state.output : undefined,
            }).slice(0, 1000),
          },
        ]
      }),
    }
  })
  const available = Effect.fn("SessionTaskFacts.available")(function* (sessionID: SessionSchema.ID) {
    const facts = yield* load(sessionID)
    return {
      requests: facts.requests
        .toSorted((a, b) => b.created - a.created)
        .slice(0, 5)
        .map((request) => ({ ...request, text: request.text.slice(0, 1200) })),
      results: facts.results
        .filter((result) => !bookkeeping.has(result.tool))
        .toSorted((a, b) => b.completed - a.completed)
        .slice(0, 20)
        .map((result) => ({
          callID: result.callID,
          messageID: result.messageID,
          tool: result.tool,
          successful: result.successful,
          summary: result.summary,
        })),
    }
  })
  return { load, available }
})

function success(tool: string, data: Record<string, unknown>) {
  if (bookkeeping.has(tool) || data.error || data.isError || data.timeout) return false
  if (tool === "bash" || tool === "shell") return data.exit === 0 || data.exitCode === 0
  return true
}

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/SessionTaskFacts") {}
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [Database.node] })
