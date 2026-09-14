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

export type Kind = "edit" | "verification" | "bookkeeping" | "other"
export type Result = {
  callID: string
  messageID: string
  tool: string
  hash: string
  completed: number
  successful: boolean
  errored: boolean
  /** File edits invalidate earlier evidence; verification commands are evidence but never invalidate. */
  kind: Kind
  /** Files an edit touched, when the input names them; empty means unknown, which matches every proof. */
  paths: string[]
  settled: boolean
  /**
   * Left pending or running in an assistant message that has since closed — a crashed or aborted
   * turn. Such a part is reported settled and errored: it neither proves nor invalidates anything,
   * and it is not "still running".
   */
  abandoned: boolean
  /** The failure text of an errored result; empty otherwise. */
  error: string
  input: unknown
  summary: string
}
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex")
const edits = new Set(["write", "edit", "apply_patch", "multiedit", "design_edit", "design_generate", "design_asset"])
/**
 * Results that check work rather than change it: shell commands (successful only on exit 0) and the
 * design tools that render or export the current revision. Only these are ever selected as evidence
 * on the model's behalf, and they never invalidate earlier evidence.
 */
const verifications = new Set(["bash", "shell", "design_preview", "design_export"])
const bookkeeping = new Set(["todowrite", "todoread", "plan_exit", "goal_status", "goal_complete"])
export const kind = (tool: string): Kind =>
  edits.has(tool) ? "edit" : verifications.has(tool) ? "verification" : bookkeeping.has(tool) ? "bookkeeping" : "other"

/**
 * Whether an edit's files overlap a proof's files; a side without paths is treated as touching
 * everything, and a directory (a grep or glob root) overlaps the files beneath it.
 */
export const overlaps = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  !a.length ||
  !b.length ||
  a.some((x) =>
    b.some(
      (y) =>
        x === y ||
        x.endsWith(`/${y}`) ||
        y.endsWith(`/${x}`) ||
        x.startsWith(`${y.replace(/\/+$/, "")}/`) ||
        y.startsWith(`${x.replace(/\/+$/, "")}/`),
    ),
  )

/** Files named by a tool's input: explicit path fields, or the file headers of a patch. */
export function paths(tool: string, input: unknown): string[] {
  if (verifications.has(tool) || bookkeeping.has(tool) || typeof input !== "object" || input === null) return []
  const record = input as Record<string, unknown>
  const named = ["filePath", "path", "file_path"].flatMap((key) =>
    typeof record[key] === "string" && record[key] ? [record[key] as string] : [],
  )
  const patch =
    typeof record.patchText === "string"
      ? [...record.patchText.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((match) =>
          match[1]!.trim(),
        )
      : []
  return [...new Set([...named, ...patch])]
}

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
            const closed =
              message.time.completed !== undefined || message.finish !== undefined || message.error !== undefined
            if (part.type !== "tool") return []
            const input = part.state.status === "pending" ? undefined : part.state.input
            const settled = part.state.status === "completed" || part.state.status === "error"
            const abandoned = !settled && closed
            return [
              {
                callID: part.id,
                messageID: message.id,
                tool: part.name,
                hash: hash(part.state),
                completed: DateTime.toEpochMillis(part.time.completed ?? part.time.ran ?? part.time.created),
                successful: part.state.status === "completed" && success(part.name, part.state.structured),
                errored: part.state.status === "error" || abandoned,
                kind: kind(part.name),
                paths: paths(part.name, input),
                settled: settled || abandoned,
                abandoned,
                error: part.state.status === "error" ? text(part.state.error) : "",
                input,
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
    const assistants = new Map(
      legacy.flatMap((row) => {
        if (row.data.role !== "assistant") return []
        const data = row.data as { time: { completed?: number }; error?: unknown }
        // A closed assistant message is not running anything any more.
        return [[row.id, data.time.completed !== undefined || data.error !== undefined] as const]
      }),
    )
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
        const settled = part.state.status === "completed" || part.state.status === "error"
        const abandoned = !settled && assistants.get(part.messageID) === true
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
            errored: part.state.status === "error" || abandoned,
            kind: kind(part.tool),
            paths: paths(part.tool, part.state.input),
            settled: settled || abandoned,
            abandoned,
            error: part.state.status === "error" ? text(part.state.error) : "",
            input: part.state.input,
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
        .filter((result) => result.kind !== "bookkeeping")
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

function text(error: unknown) {
  if (typeof error === "string") return error
  if (typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string")
    return (error as { message: string }).message
  return ""
}

function success(tool: string, data: Record<string, unknown>) {
  if (bookkeeping.has(tool) || data.error || data.isError || data.timeout) return false
  if (tool === "bash" || tool === "shell") return data.exit === 0 || data.exitCode === 0
  return true
}

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/SessionTaskFacts") {}
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [Database.node] })
