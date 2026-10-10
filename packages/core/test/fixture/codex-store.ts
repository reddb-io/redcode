export * as CodexStore from "./codex-store"

import { mkdirSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"

// Synthetic records shaped like a Codex rollout, limited to the fields the importer reads.

export type Line = { readonly [key: string]: unknown }

export const iso = (time: number) => new Date(Date.UTC(2026, 0, 1) + time * 1000).toISOString()

const record = (type: string, time: number, payload: Line): Line => ({ timestamp: iso(time), type, payload })
export const item = (time: number, payload: Line) => record("response_item", time, payload)
const text = (type: string, value: string) => ({ type, text: value })

export const meta = (id: string, cwd: string, time: number, extra: Line = {}) =>
  record("session_meta", time, {
    id,
    session_id: id,
    timestamp: iso(time),
    cwd,
    originator: "codex_cli_rs",
    cli_version: "0.200.0",
    model_provider: "openai",
    history_mode: "paginated",
    ...extra,
  })

export const context = (time: number, model: string) =>
  record("turn_context", time, { turn_id: `turn-${time}`, cwd: "/", model, effort: "high", summary: "auto" })

export const user = (time: number, content: ReadonlyArray<Line> | string, kinds?: ReadonlyArray<string>) =>
  item(time, {
    type: "message",
    role: "user",
    content: typeof content === "string" ? [text("input_text", content)] : content,
    ...(kinds ? { internal_chat_message_metadata_passthrough: { content_item_kinds: kinds } } : {}),
  })

export const developer = (time: number, value: string) =>
  item(time, { type: "message", role: "developer", content: [text("input_text", value)] })

export const assistant = (time: number, value: string) =>
  item(time, { type: "message", role: "assistant", phase: "final_answer", content: [text("output_text", value)] })

export const reasoning = (time: number, summary: ReadonlyArray<string>) =>
  item(time, {
    type: "reasoning",
    summary: summary.map((value) => text("summary_text", value)),
    content: null,
    encrypted_content: "gAAAA-synthetic",
  })

export const call = (time: number, callID: string, name: string, args: Line, namespace?: string) =>
  item(time, {
    type: "function_call",
    name,
    ...(namespace ? { namespace } : {}),
    arguments: JSON.stringify(args),
    call_id: callID,
  })

export const custom = (time: number, callID: string, name: string, input: string) =>
  item(time, { type: "custom_tool_call", name, input, call_id: callID, status: "completed" })

export const output = (time: number, callID: string, value: unknown, type = "function_call_output") =>
  item(time, { type, call_id: callID, output: value })

export const usage = (time: number, input = 100, output = 30) =>
  record("token_usage_record", time, {
    usage: {
      input_tokens: input,
      cached_input_tokens: 40,
      output_tokens: output,
      reasoning_output_tokens: 10,
      total_tokens: input + output,
    },
  })

export const tokenCount = (time: number) =>
  record("event_msg", time, {
    type: "token_count",
    info: { last_token_usage: { input_tokens: 999, output_tokens: 999 } },
    rate_limits: null,
  })

export const event = (time: number, type: string) => record("event_msg", time, { type })

export const compacted = (time: number, message: string, history: ReadonlyArray<Line>) =>
  record("compacted", time, {
    message,
    replacement_history: [
      ...history.map((line) => line.payload),
      { type: "compaction", encrypted_content: "gAAAA-synthetic" },
    ],
  })

export const agentMessage = (time: number, author: string, value: string) =>
  item(time, {
    type: "agent_message",
    author,
    recipient: "/root",
    content: [text("input_text", value), { type: "encrypted_content", encrypted_content: "gAAAA-synthetic" }],
  })

export const image = (type = "input_image") => ({ type, image_url: "data:image/png;base64,aGVsbG8=" })

/** Rollout text with ordinals numbered from `from`. */
export const jsonl = (records: ReadonlyArray<Line>, from = 0) =>
  records.map((line, index) => JSON.stringify({ ...line, ordinal: from + index })).join("\n") + "\n"

/** Write a rollout into a Codex home directory, as an active or archived session. */
export function write(
  root: string,
  input: {
    readonly thread: string
    readonly records: ReadonlyArray<Line>
    readonly from?: number
    readonly page?: string
    readonly archived?: boolean
    /** Seconds after the fixture epoch, for the file's modification time. */
    readonly mtime?: number
  },
) {
  const stamp = "2026-01-01T00-00-00"
  const dir = input.archived ? path.join(root, "archived_sessions") : path.join(root, "sessions", "2026", "01", "01")
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `rollout-${stamp}-${input.thread}${input.page ? `_${input.page}` : ""}.jsonl`)
  writeFileSync(file, jsonl(input.records, input.from))
  if (input.mtime !== undefined) {
    const at = new Date(Date.UTC(2026, 0, 1) + input.mtime * 1000)
    utimesSync(file, at, at)
  }
  return file
}

/** Write the session index Codex keeps the thread names in. */
export function index(root: string, entries: ReadonlyArray<{ readonly id: string; readonly name: string }>) {
  mkdirSync(root, { recursive: true })
  writeFileSync(
    path.join(root, "session_index.jsonl"),
    entries.map((entry) => JSON.stringify({ id: entry.id, thread_name: entry.name, updated_at: iso(0) })).join("\n") +
      "\n",
  )
}
