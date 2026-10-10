export * as CodexImport from "./codex.js"

import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionImport } from "@opencode/schema/session-import"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { sameDirectory } from "@opencode/util/path"
import { Redact } from "@opencode/util/redact"
import { Effect, Option, Schema } from "effect"
import { existsSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ToolInterrupted } from "../tool-interrupted.js"
import { ImportSource } from "./source.js"

const NAME = "Codex"
/** The most text one tool output keeps; Codex stores whole command logs and file reads inline. */
export const OUTPUT_LIMIT = 64 * 1024
/** How much of each end of a large rollout is read to list it without parsing the whole file. */
const SAMPLE = 256 * 1024

const Count = Schema.optionalKey(Schema.NullOr(Schema.Finite))
const Usage = Schema.Struct({
  input_tokens: Count,
  cached_input_tokens: Count,
  cache_write_input_tokens: Count,
  output_tokens: Count,
  reasoning_output_tokens: Count,
})
type Usage = typeof Usage.Type

const Text = Schema.optionalKey(Schema.NullOr(Schema.String))
const Spawn = Schema.Struct({ parent_thread_id: Text, agent_path: Text, agent_nickname: Text })

/** The first record of a rollout. Subagent and forked rollouts start with their own meta, then a copy of their parent's. */
export const SessionMeta = Schema.Struct({
  id: Schema.String,
  timestamp: Text,
  cwd: Text,
  cli_version: Text,
  model_provider: Text,
  forked_from_id: Text,
  parent_thread_id: Text,
  agent_path: Text,
  agent_nickname: Text,
  thread_source: Text,
  /** Records before this ordinal are the parent conversation a subagent inherited. */
  subagent_history_start_ordinal: Count,
  source: Schema.optionalKey(
    Schema.Union([
      Schema.String,
      Schema.Struct({
        subagent: Schema.optionalKey(
          Schema.Union([Schema.String, Schema.Struct({ thread_spawn: Schema.optionalKey(Spawn) })]),
        ),
      }),
    ]),
  ),
  /** Set on a continuation page: the thread's history before this ordinal comes from its earlier pages. */
  history_base: Schema.optionalKey(Schema.NullOr(Schema.Struct({ end_ordinal_exclusive: Schema.Finite }))),
})
export type SessionMeta = typeof SessionMeta.Type

const Content = Schema.Array(Schema.Unknown)
const Message = Schema.Struct({
  type: Schema.Literal("message"),
  role: Schema.String,
  content: Content,
  internal_chat_message_metadata_passthrough: Schema.optionalKey(
    Schema.Struct({ content_item_kinds: Schema.optionalKey(Schema.Array(Schema.Unknown)) }),
  ),
})
const Reasoning = Schema.Struct({
  type: Schema.Literal("reasoning"),
  summary: Schema.optionalKey(Content),
  content: Schema.optionalKey(Schema.NullOr(Content)),
  encrypted_content: Text,
})
const Input = Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown))
const FunctionCall = Schema.Struct({
  type: Schema.Literal("function_call"),
  name: Schema.String,
  namespace: Text,
  arguments: Schema.String,
  call_id: Schema.String,
})
const CustomToolCall = Schema.Struct({
  type: Schema.Literal("custom_tool_call"),
  name: Schema.String,
  input: Schema.String,
  call_id: Schema.String,
})
const LocalShellCall = Schema.Struct({ type: Schema.Literal("local_shell_call"), call_id: Text, id: Text, action: Input })
const WebSearchCall = Schema.Struct({ type: Schema.Literal("web_search_call"), id: Text, action: Input })
const ToolSearchCall = Schema.Struct({
  type: Schema.Literal("tool_search_call"),
  call_id: Schema.String,
  arguments: Input,
})
const Output = Schema.optionalKey(
  Schema.Union([
    Schema.String,
    Content,
    // Older releases recorded the output with its success flag.
    Schema.Struct({
      content: Schema.optionalKey(Schema.Union([Schema.String, Content])),
      success: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
    }),
  ]),
)
const FunctionCallOutput = Schema.Struct({
  type: Schema.Literal("function_call_output"),
  call_id: Schema.String,
  output: Output,
})
const CustomToolCallOutput = Schema.Struct({
  type: Schema.Literal("custom_tool_call_output"),
  call_id: Schema.String,
  output: Output,
})
const ToolSearchOutput = Schema.Struct({
  type: Schema.Literal("tool_search_output"),
  call_id: Schema.String,
  tools: Schema.optionalKey(Content),
})
/** A message another agent of the same session delivered to this one. */
const AgentMessage = Schema.Struct({
  type: Schema.Literal("agent_message"),
  author: Schema.String,
  content: Content,
})
const GhostSnapshot = Schema.Struct({ type: Schema.Literal("ghost_snapshot") })
/** Codex's own compaction marker inside the history; the `compacted` record carries the compaction. */
const CompactionItem = Schema.Struct({ type: Schema.Literals(["compaction", "compaction_summary"]) })

/** One model-visible history item, limited to the fields the importer reads. */
export const Item = Schema.Union([
  Message,
  Reasoning,
  FunctionCall,
  CustomToolCall,
  LocalShellCall,
  WebSearchCall,
  ToolSearchCall,
  FunctionCallOutput,
  CustomToolCallOutput,
  ToolSearchOutput,
  AgentMessage,
  GhostSnapshot,
  CompactionItem,
])
export type Item = typeof Item.Type
type Call = Extract<
  Item,
  { type: "function_call" | "custom_tool_call" | "local_shell_call" | "web_search_call" | "tool_search_call" }
>
type Result = Extract<Item, { type: "function_call_output" | "custom_tool_call_output" | "tool_search_output" }>

const Line = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  timestamp: Schema.optionalKey(Schema.String),
  ordinal: Schema.optionalKey(Schema.Finite),
  payload: Schema.optionalKey(Schema.Unknown),
  record_type: Schema.optionalKey(Schema.String),
})
const TurnContext = Schema.Struct({ model: Text })
const Compacted = Schema.Struct({ message: Text, replacement_history: Schema.optionalKey(Schema.NullOr(Content)) })
const UsageRecord = Schema.Struct({ usage: Usage })
const TokenCount = Schema.Struct({
  type: Schema.Literal("token_count"),
  info: Schema.optionalKey(Schema.NullOr(Schema.Struct({ last_token_usage: Schema.optionalKey(Usage) }))),
})
const TextPart = Schema.Struct({ type: Schema.String, text: Schema.String })
const ImagePart = Schema.Struct({ type: Schema.Literal("input_image"), image_url: Schema.String })
const Part = Schema.Union([ImagePart, TextPart])
const PartType = Schema.Struct({ type: Schema.String })
const Named = Schema.Struct({ name: Schema.String, tools: Schema.optionalKey(Content) })
const Spawned = Schema.Struct({ task_name: Schema.String })

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeLine = Schema.decodeUnknownOption(Line)
const decodeMeta = Schema.decodeUnknownOption(SessionMeta)
const decodeItem = Schema.decodeUnknownOption(Item)
const decodeContext = Schema.decodeUnknownOption(TurnContext)
const decodeCompacted = Schema.decodeUnknownOption(Compacted)
const decodeUsageRecord = Schema.decodeUnknownOption(UsageRecord)
const decodeTokenCount = Schema.decodeUnknownOption(TokenCount)
const decodePart = Schema.decodeUnknownOption(Part)
const decodePartType = Schema.decodeUnknownOption(PartType)
const decodeNamed = Schema.decodeUnknownOption(Named)
const decodeArguments = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))
const decodeSpawned = Schema.decodeUnknownOption(Schema.fromJsonString(Spawned))
const decodeInfo = Schema.decodeOption(Session.Info)
const decodeMessage = Schema.decodeOption(SessionMessage.Info)

interface Stamp {
  readonly timestamp?: string
  readonly ordinal?: number
}

/** One rollout line, decoded once by what it records. */
export type Entry = Stamp &
  (
    | { readonly kind: "meta"; readonly meta: SessionMeta }
    | { readonly kind: "context"; readonly model?: string }
    | { readonly kind: "item"; readonly item: Item }
    | { readonly kind: "unsupported"; readonly name: string }
    | { readonly kind: "compacted"; readonly summary: string; readonly history: ReadonlyArray<Item> }
    | { readonly kind: "usage"; readonly usage: Usage }
    | { readonly kind: "other" }
  )

export interface Transcript {
  readonly entries: ReadonlyArray<Entry>
  /** Lines that were not readable records. */
  readonly invalid: number
}

export interface Thread {
  /** The Codex thread ID, which names the rollout files. */
  readonly id: string
  /** The thread's rollout files, the original first and continuation pages after it in creation order. */
  readonly pages: ReadonlyArray<Transcript>
}

export interface Input {
  readonly thread: Thread
  /** Subagent threads the session started, at any depth. */
  readonly subagents: ReadonlyArray<Thread>
  /** The name Codex shows for the thread, from its session index. */
  readonly title?: string
}

export type Normalized = {
  readonly sessions: ReadonlyArray<{
    readonly ref: string
    readonly version?: string
    readonly data: SessionTransfer.Data
    readonly warnings: ReadonlyArray<string>
  }>
}

/** Parse rollout text, one JSON record per line; unreadable lines are counted rather than fatal. */
export function parse(text: string): Transcript {
  return collect(text.split("\n"))
}

function collect(lines: Iterable<string>) {
  const entries: Array<Entry> = []
  const state = { invalid: 0 }
  for (const line of lines) {
    if (!line.trim()) continue
    const entry = Option.flatMap(decodeJson(line), decode)
    if (Option.isSome(entry)) entries.push(entry.value)
    else state.invalid++
  }
  return { entries, invalid: state.invalid }
}

function decode(json: unknown): Option.Option<Entry> {
  return Option.flatMap(decodeLine(json), (line): Option.Option<Entry> => {
    const stamp = {
      ...(line.timestamp ? { timestamp: line.timestamp } : {}),
      ...(line.ordinal !== undefined ? { ordinal: line.ordinal } : {}),
    }
    if (line.payload === undefined) return legacy(json, line)
    if (line.type === "session_meta") return Option.map(decodeMeta(line.payload), (meta) => ({ ...stamp, kind: "meta", meta }))
    if (line.type === "turn_context")
      return Option.map(decodeContext(line.payload), (context) => ({
        ...stamp,
        kind: "context",
        ...(context.model ? { model: context.model } : {}),
      }))
    if (line.type === "response_item")
      return Option.some(
        Option.match(decodeItem(line.payload), {
          onNone: () => ({
            ...stamp,
            kind: "unsupported",
            name: Option.getOrUndefined(decodePartType(line.payload))?.type ?? "unknown",
          }),
          onSome: (item) => ({ ...stamp, kind: "item", item }),
        }),
      )
    if (line.type === "compacted")
      return Option.map(decodeCompacted(line.payload), (compacted) => ({
        ...stamp,
        kind: "compacted",
        summary: compacted.message ?? "",
        history: (compacted.replacement_history ?? []).flatMap((item) => Option.toArray(decodeItem(item))),
      }))
    if (line.type === "token_usage_record")
      return Option.some(
        Option.match(decodeUsageRecord(line.payload), {
          onNone: () => ({ ...stamp, kind: "other" }),
          onSome: (record) => ({ ...stamp, kind: "usage", usage: record.usage }),
        }),
      )
    const usage = Option.flatMap(decodeTokenCount(line.payload), (event) =>
      Option.fromNullishOr(event.info?.last_token_usage),
    )
    return Option.some(
      Option.match(usage, {
        onNone: () => ({ ...stamp, kind: "other" }),
        onSome: (usage) => ({ ...stamp, kind: "usage", usage }),
      }),
    )
  })
}

/**
 * Rollouts written before mid-2025 start with a bare meta record and list bare history items
 * without timestamps, interleaved with `record_type: "state"` lines.
 */
function legacy(json: unknown, line: typeof Line.Type): Option.Option<Entry> {
  if (line.record_type) return Option.some({ kind: "other" })
  if (line.type === undefined)
    return Option.map(decodeMeta(json), (meta) => ({
      ...(meta.timestamp ? { timestamp: meta.timestamp } : {}),
      kind: "meta",
      meta,
    }))
  return Option.some(
    Option.match(decodeItem(json), {
      onNone: () => ({ kind: "unsupported", name: line.type ?? "unknown" }),
      onSome: (item) => ({ kind: "item", item }),
    }),
  )
}

/** How Codex's tools correspond to Redcode's, for a model that continues an imported session. */
export const TOOL_NOTE =
  "Codex tools correspond to yours as follows: shell, shell_command, exec_command, exec and local_shell → shell; write_stdin → shell (input to a running command); apply_patch → patch; update_plan → todowrite; view_image → read; web_search → websearch; spawn_agent → subagent; request_user_input → question. Tools without a counterpart, including MCP tools and the collaboration tools that message other agents, may be unavailable."

/**
 * Normalize one Codex thread and its subagent threads into transfer data, parents before children.
 * A thread's history continues across pages; a subagent thread's own history follows the parent
 * conversation it inherited, which is not imported again.
 */
export function normalize(input: Input): Normalized {
  const entries = history(input.thread.pages)
  const meta = metaOf(entries)
  const last = entries.at(-1)
  // The end of the history names the snapshot, so a continued or rolled-back thread imports anew.
  const seed = `codex:${input.thread.id}:${input.thread.pages.length}:${last?.ordinal ?? entries.length}`
  const found = descendants(input.thread.id, input.subagents)
  // A subagent that never ran past its inherited context has nothing to import.
  const threads = found.filter((thread) => messageCount(thread.entries) > 0)
  const ids = new Map(
    threads.map((thread) => [
      thread.id,
      ImportSource.stableID("ses", `${seed}:agent:${thread.id}`, start(thread.entries), true),
    ]),
  )
  const links = new Map(
    threads.flatMap((thread) => {
      const agentPath = spawnOf(thread.meta)?.agent_path ?? thread.meta?.agent_path
      return agentPath ? [[agentPath, ids.get(thread.id) ?? ""] as const] : []
    }),
  )
  const rootID = ImportSource.stableID("ses", seed, start(entries), true)
  const directory = ImportSource.directory(meta?.cwd ?? "")
  const provider = meta?.model_provider || "openai"
  const children = threads.map((thread) => ({
    ...session({
      id: ids.get(thread.id) ?? "",
      parentID: ids.get(parentOf(thread.meta) ?? "") ?? rootID,
      seed: `${seed}:agent:${thread.id}`,
      entries: thread.entries,
      invalid: thread.invalid,
      agent: "general",
      title: (messages) =>
        agentName(thread.meta) ?? firstPrompt(messages) ?? `${NAME} subagent ${thread.id.slice(0, 8)}`,
      directory,
      provider,
      links,
    }),
    ref: thread.id,
  }))
  const empty = found.length - threads.length
  const root = session({
    id: rootID,
    seed,
    entries,
    invalid: input.thread.pages.reduce((total, page) => total + page.invalid, 0),
    agent: "build",
    title: (messages) => input.title || firstPrompt(messages) || `${NAME} session ${input.thread.id.slice(0, 8)}`,
    directory,
    provider,
    links,
    extra: empty > 0 ? [`Skipped ${count(empty, "subagent session")} without messages`] : [],
  })
  return {
    sessions: [{ ...root, ref: input.thread.id }, ...children].flatMap((item) =>
      Option.match(item.info, {
        onNone: () => [],
        onSome: (info) => [
          {
            ref: item.ref,
            ...(item.version ? { version: item.version } : {}),
            data: { info, messages: item.messages },
            warnings: item.warnings,
          },
        ],
      }),
    ),
  }
}

/**
 * The thread's active history. A continuation page replaces everything from its base ordinal on,
 * so the earlier pages contribute only the records before it.
 */
function history(pages: ReadonlyArray<Transcript>): ReadonlyArray<Entry> {
  const last = pages.at(-1)
  if (!last) return []
  const base = metaOf(last.entries)?.history_base?.end_ordinal_exclusive
  if (base === undefined) return last.entries
  const earlier = pages.slice(0, -1).filter((page) => (page.entries[0]?.ordinal ?? 0) < base)
  return [...history(earlier).filter((entry) => entry.ordinal !== undefined && entry.ordinal < base), ...last.entries]
}

function metaOf(entries: ReadonlyArray<Entry>) {
  const first = entries.find((entry) => entry.kind === "meta")
  return first?.kind === "meta" ? first.meta : undefined
}

function spawnOf(meta: SessionMeta | undefined) {
  const subagent = typeof meta?.source === "object" ? meta.source.subagent : undefined
  return typeof subagent === "object" ? subagent.thread_spawn : undefined
}

function parentOf(meta: SessionMeta | undefined) {
  return meta?.parent_thread_id ?? spawnOf(meta)?.parent_thread_id ?? undefined
}

/** A thread another thread started: a subagent, a review or another internal agent. */
export function isSubagent(meta: SessionMeta) {
  return (
    parentOf(meta) !== undefined ||
    meta.thread_source === "subagent" ||
    (typeof meta.source === "object" && meta.source.subagent !== undefined)
  )
}

function agentName(meta: SessionMeta | undefined) {
  const agentPath = spawnOf(meta)?.agent_path ?? meta?.agent_path
  return agentPath?.split("/").filter(Boolean).at(-1) ?? meta?.agent_nickname ?? undefined
}

/** The subagent threads below `root`, each after the thread that started it, with their own history only. */
function descendants(root: string, threads: ReadonlyArray<Thread>) {
  const resolved = threads.map((thread) => {
    const entries = history(thread.pages)
    const meta = metaOf(entries)
    const from = meta?.subagent_history_start_ordinal
    return {
      id: thread.id,
      meta,
      entries:
        typeof from === "number" ? entries.filter((entry) => entry.ordinal === undefined || entry.ordinal >= from) : entries,
      invalid: thread.pages.reduce((total, page) => total + page.invalid, 0),
    }
  })
  const children = Map.groupBy(resolved, (thread) => parentOf(thread.meta) ?? root)
  const visit = (parent: string, seen: ReadonlySet<string>): ReadonlyArray<(typeof resolved)[number]> =>
    (children.get(parent) ?? [])
      .filter((thread) => !seen.has(thread.id))
      .toSorted((a, b) => Number(start(a.entries) - start(b.entries)) || a.id.localeCompare(b.id))
      .flatMap((thread) => [thread, ...visit(thread.id, new Set([...seen, thread.id]))])
  return visit(root, new Set([root]))
}

interface Tally {
  injected: number
  developer: number
  encrypted: number
  summaries: number
  compactions: number
  messages: number
  snapshots: number
  truncated: number
  interrupted: number
  images: number
  blocks: Set<string>
}

function session(input: {
  readonly id: string
  readonly parentID?: string
  readonly seed: string
  readonly entries: ReadonlyArray<Entry>
  readonly invalid: number
  readonly agent: string
  readonly title: (messages: ReadonlyArray<SessionMessage.Info>) => string
  readonly directory: string
  readonly provider: string
  /** Child session IDs by the agent path Codex gave the subagent. */
  readonly links: ReadonlyMap<string, string>
  readonly extra?: ReadonlyArray<string>
}) {
  const tally: Tally = {
    injected: 0,
    developer: 0,
    encrypted: 0,
    summaries: 0,
    compactions: 0,
    messages: 0,
    snapshots: 0,
    truncated: 0,
    interrupted: 0,
    images: 0,
    blocks: new Set(),
  }
  const messages = convert({ ...input, tally }).flatMap((encoded) => {
    const decoded = decodeMessage(encoded)
    if (Option.isSome(decoded)) return [decoded.value]
    tally.blocks.add(`unreadable ${encoded.type} message`)
    return []
  })
  const steps = messages.filter((message) => message.type === "assistant")
  const final = steps.at(-1)
  const timed = input.entries.filter((entry) => entry.timestamp)
  const created = millis(timed[0]?.timestamp)
  const info = decodeInfo({
    id: input.id,
    ...(input.parentID ? { parentID: input.parentID } : {}),
    projectID: Project.ID.global,
    agent: input.agent,
    ...(final ? { model: { id: final.model.id, providerID: final.model.providerID } } : {}),
    cost: 0,
    tokens: steps.reduce(
      (total, step) => ({
        input: total.input + (step.tokens?.input ?? 0),
        output: total.output + (step.tokens?.output ?? 0),
        reasoning: total.reasoning + (step.tokens?.reasoning ?? 0),
        cache: {
          read: total.cache.read + (step.tokens?.cache.read ?? 0),
          write: total.cache.write + (step.tokens?.cache.write ?? 0),
        },
      }),
      { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ),
    time: { created, updated: Math.max(created, millis(timed.at(-1)?.timestamp)) },
    title: input.title(messages),
    location: { directory: input.directory },
  })
  return {
    info,
    messages,
    version: metaOf(input.entries)?.cli_version ?? undefined,
    warnings: [...warnings(input.invalid, tally), ...(input.extra ?? [])],
  }
}

function warnings(invalid: number, tally: Tally) {
  return [
    invalid && `Skipped ${count(invalid, "unreadable line")}`,
    tally.injected &&
      `Dropped ${count(tally.injected, "injected context message")} (environment context, AGENTS.md and app context)`,
    tally.developer &&
      `Dropped ${count(tally.developer, "developer message")} (permission, sandbox and collaboration instructions)`,
    tally.encrypted &&
      `Dropped the encrypted content of ${count(tally.encrypted, "reasoning item")}; ${count(tally.summaries, "readable summary", "readable summaries")} ${tally.summaries === 1 ? "is" : "are"} kept`,
    tally.compactions &&
      `Codex encrypted ${count(tally.compactions, "compaction summary", "compaction summaries")}; each compaction keeps only the user messages Codex retained`,
    tally.messages && `Dropped the encrypted content of ${count(tally.messages, "message")} from other agents`,
    tally.images && `Skipped ${count(tally.images, "image")} that ${tally.images === 1 ? "was" : "were"} not inline`,
    tally.truncated && `Truncated ${count(tally.truncated, "tool output")} above 64 KB`,
    tally.interrupted && `Marked ${count(tally.interrupted, "tool call")} without a result as interrupted`,
    tally.blocks.size > 0 && `Skipped unsupported content: ${[...tally.blocks].toSorted().join(", ")}`,
    tally.snapshots > 0 &&
      `File snapshots were not imported (${count(tally.snapshots, "snapshot")}); edits made before the import cannot be reverted`,
  ].filter((warning): warning is string => typeof warning === "string")
}

type Encoded = (typeof SessionMessage.Info)["Encoded"]
type AssistantEncoded = Extract<Encoded, { type: "assistant" }>
type ContentEncoded = (typeof SessionMessage.AssistantContent)["Encoded"]
type ToolEncoded = Extract<ContentEncoded, { type: "tool" }>
type OutputEncoded = (typeof SessionMessage.ToolStateCompleted)["Encoded"]["content"][number]

interface Step {
  readonly id: string
  readonly created: number
  completed: number
  readonly model: string
  readonly content: Array<ContentEncoded>
  usage?: Usage
}

/**
 * Convert the history into Redcode messages. The items of one model response become one step,
 * which ends where tool results or the next input are recorded; the response's usage follows it.
 */
function convert(input: {
  readonly seed: string
  readonly entries: ReadonlyArray<Entry>
  readonly agent: string
  readonly provider: string
  readonly links: ReadonlyMap<string, string>
  readonly tally: Tally
}): ReadonlyArray<Encoded> {
  const tally = input.tally
  const results = new Map(
    input.entries.flatMap((entry) =>
      entry.kind === "item" && isResult(entry.item) ? [[entry.item.call_id, { item: entry.item, entry }] as const] : [],
    ),
  )
  const ids = ImportSource.messageIDs(input.seed)
  const out: Array<Encoded | { readonly step: Step }> = []
  const state: { at: number; model: string; open?: Step; last?: Step } = { at: 0, model: "unknown" }
  input.entries.forEach((entry, index) => {
    // Older rollouts record no time on history items; they take the last recorded time.
    state.at = millis(entry.timestamp) || state.at
    const at = state.at
    if (entry.kind === "context") {
      if (entry.model) state.model = entry.model
      return
    }
    if (entry.kind === "usage") {
      // Usage follows the response's items and its tool results; later copies of it are ignored.
      if (state.last && !state.last.usage) state.last.usage = entry.usage
      state.open = undefined
      return
    }
    if (entry.kind === "unsupported") {
      tally.blocks.add(`${entry.name} item`)
      return
    }
    if (entry.kind === "compacted") {
      state.open = undefined
      if (!entry.summary) tally.compactions++
      out.push({
        id: ids(String(index), at),
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary:
          entry.summary ||
          "Codex compacted the earlier conversation into an encrypted summary that could not be imported; the user messages it kept follow.",
        recent: retained(entry.history),
        time: { created: at },
      })
      return
    }
    if (entry.kind !== "item") return
    const item = entry.item
    if (item.type === "message" && item.role === "assistant") {
      const step = open(state, out, ids(String(index), at), at)
      item.content.forEach((value) => {
        const part = Option.getOrUndefined(decodePart(value))
        if (part?.type === "output_text" || part?.type === "text") {
          if (part.text) step.content.push({ type: "text", text: part.text })
          return
        }
        tally.blocks.add(`${partType(value)} in an assistant message`)
      })
      step.completed = at
      return
    }
    if (item.type === "reasoning") {
      const step = open(state, out, ids(String(index), at), at)
      const text = [...(item.summary ?? []), ...(item.summary?.length ? [] : (item.content ?? []))]
        .flatMap((value) => Option.toArray(decodePart(value)))
        .flatMap((part) => ("text" in part && part.text ? [part.text] : []))
        .join("\n\n")
      if (item.encrypted_content) tally.encrypted++
      if (item.encrypted_content && text) tally.summaries++
      if (text) step.content.push({ type: "reasoning", text })
      step.completed = at
      return
    }
    if (isCall(item)) {
      const step = open(state, out, ids(String(index), at), at)
      step.content.push(tool({ item, created: at, results, links: input.links, tally }))
      step.completed = at
      return
    }
    // Everything else is input to the model, which ends the response being collected.
    state.open = undefined
    if (isResult(item) || item.type === "compaction" || item.type === "compaction_summary") return
    if (item.type === "ghost_snapshot") {
      tally.snapshots++
      return
    }
    if (item.type === "agent_message") {
      const parts = item.content.flatMap((value) => Option.toArray(decodePart(value)))
      if (item.content.length > parts.length) tally.messages++
      const text = parts.flatMap((part) => ("text" in part ? [part.text] : [])).join("\n\n")
      if (text)
        out.push({
          id: ids(String(index), at),
          type: "synthetic",
          text,
          description: `Message from ${item.author}`,
          time: { created: at },
        })
      return
    }
    if (item.type !== "message") return
    if (item.role !== "user") {
      tally.developer++
      return
    }
    const prompt = userPrompt(item, tally)
    if (!prompt) return
    out.push({
      id: ids(String(index), at),
      type: "user",
      text: prompt.text,
      ...(prompt.files.length > 0 ? { files: prompt.files } : {}),
      time: { created: at },
    })
  })
  // A response whose only item was unreadable reasoning leaves nothing to show.
  return out.flatMap((message) =>
    "step" in message ? (message.step.content.length > 0 ? [assistant(message.step, input)] : []) : [message],
  )
}

function open(
  state: { model: string; open?: Step; last?: Step },
  out: Array<Encoded | { readonly step: Step }>,
  id: string,
  at: number,
) {
  if (state.open) return state.open
  const step: Step = { id, created: at, completed: at, model: state.model, content: [] }
  state.open = step
  state.last = step
  out.push({ step })
  return step
}

function assistant(step: Step, input: { readonly agent: string; readonly provider: string }): AssistantEncoded {
  const usage = step.usage
  const tools = step.content.some((part) => part.type === "tool")
  const cached = usage?.cached_input_tokens ?? 0
  const written = usage?.cache_write_input_tokens ?? 0
  const reasoning = usage?.reasoning_output_tokens ?? 0
  return {
    id: step.id,
    type: "assistant",
    agent: input.agent,
    model: { id: step.model, providerID: input.provider },
    content: step.content,
    // A response with recorded usage completed; one without was cut off or predates usage records.
    ...(usage ? { finish: tools ? ("tool-calls" as const) : ("stop" as const) } : {}),
    ...(usage
      ? {
          // Codex reports the OpenAI totals: input includes cached tokens and output includes reasoning.
          tokens: {
            input: Math.max(0, (usage.input_tokens ?? 0) - cached - written),
            output: Math.max(0, (usage.output_tokens ?? 0) - reasoning),
            reasoning,
            cache: { read: cached, write: written },
          },
        }
      : {}),
    time: { created: step.created, completed: Math.max(step.created, step.completed) },
  }
}

function isCall(item: Item): item is Call {
  return (
    item.type === "function_call" ||
    item.type === "custom_tool_call" ||
    item.type === "local_shell_call" ||
    item.type === "web_search_call" ||
    item.type === "tool_search_call"
  )
}

function isResult(item: Item): item is Result {
  return (
    item.type === "function_call_output" ||
    item.type === "custom_tool_call_output" ||
    item.type === "tool_search_output"
  )
}

function tool(input: {
  readonly item: Call
  readonly created: number
  readonly results: ReadonlyMap<string, { readonly item: Result; readonly entry: Entry }>
  readonly links: ReadonlyMap<string, string>
  readonly tally: Tally
}): ToolEncoded {
  const call = describe(input.item)
  const base = { type: "tool" as const, id: call.id, name: call.name }
  // Web searches run on the provider and record no result.
  if (input.item.type === "web_search_call")
    return {
      ...base,
      state: { status: "completed", input: call.input, content: [{ type: "text", text: "(no output)" }] },
      time: { created: input.created, completed: input.created },
    }
  const result = input.results.get(call.id)
  if (!result) {
    // A call left without a result was cut off, whether or not the session continued after it.
    input.tally.interrupted++
    return {
      ...base,
      state: { status: "error", input: call.input, error: { type: "aborted", message: ToolInterrupted.MESSAGE } },
      time: { created: input.created },
    }
  }
  const content = output(result.item, input.tally)
  const spawned = content.flatMap((item) =>
    item.type === "text" ? Option.toArray(decodeSpawned(item.text)).map((value) => value.task_name) : [],
  )[0]
  const child = spawned === undefined ? undefined : input.links.get(spawned)
  const metadata = child ? { metadata: { sessionID: child } } : {}
  const time = { created: input.created, completed: Math.max(input.created, millis(result.entry.timestamp)) }
  if (result.item.type !== "tool_search_output" && isFailure(result.item.output))
    return {
      ...base,
      state: {
        status: "error",
        input: call.input,
        error: { type: "tool", message: errorMessage(content) },
        content,
        ...metadata,
      },
      time,
    }
  return { ...base, state: { status: "completed", input: call.input, content, ...metadata }, time }
}

/** A tool call's ID, its name with any namespace, and its input as an object. */
function describe(item: Call) {
  if (item.type === "function_call")
    return {
      id: item.call_id,
      name: item.namespace ? `${item.namespace}__${item.name}` : item.name,
      input: Option.getOrElse(decodeArguments(item.arguments), () => ({ arguments: item.arguments })),
    }
  if (item.type === "custom_tool_call") return { id: item.call_id, name: item.name, input: { input: item.input } }
  if (item.type === "local_shell_call")
    return { id: item.call_id ?? item.id ?? "", name: "local_shell", input: item.action ?? {} }
  if (item.type === "web_search_call") return { id: item.id ?? "", name: "web_search", input: item.action ?? {} }
  return { id: item.call_id, name: "tool_search", input: item.arguments ?? {} }
}

type OutputValue = (typeof FunctionCallOutput.Type)["output"]

function isFailure(output: OutputValue) {
  return typeof output === "object" && !isList(output) && output.success === false
}

// `Array.isArray` does not narrow readonly arrays out of a union.
function isList(value: unknown): value is ReadonlyArray<unknown> {
  return Array.isArray(value)
}

/** A tool result's model-visible output, with secrets redacted and oversized text truncated. */
function output(item: Result, tally: Tally): [OutputEncoded, ...Array<OutputEncoded>] {
  const items: ReadonlyArray<OutputEncoded> =
    item.type === "tool_search_output" ? [{ type: "text", text: toolNames(item.tools ?? []) }] : parts(item.output, tally)
  const [head, ...rest] = items
    .filter((value) => value.type !== "text" || value.text)
    .map((value) => (value.type === "text" ? { ...value, text: limit(value.text, tally) } : value))
  return head ? [head, ...rest] : [{ type: "text", text: "(no output)" }]
}

function parts(value: OutputValue, tally: Tally): ReadonlyArray<OutputEncoded> {
  if (value === undefined) return []
  if (typeof value === "string") return [{ type: "text", text: value }]
  const content = isList(value) ? value : value.content
  if (typeof content === "string") return [{ type: "text", text: content }]
  return (content ?? []).flatMap((entry): ReadonlyArray<OutputEncoded> => {
    const part = Option.getOrUndefined(decodePart(entry))
    if (!part) {
      tally.blocks.add(`${partType(entry)} in a tool result`)
      return []
    }
    if ("text" in part) return [{ type: "text", text: part.text }]
    const image = inline(part.image_url)
    if (image) return [{ type: "file", uri: part.image_url, mime: image.mime }]
    tally.images++
    return []
  })
}

/** The tools a tool search loaded, named the way their calls are. */
function toolNames(tools: ReadonlyArray<unknown>) {
  return tools
    .flatMap((value) => Option.toArray(decodeNamed(value)))
    .flatMap((named) =>
      named.tools
        ? named.tools.flatMap((child) =>
            Option.toArray(decodeNamed(child)).map((tool) => `${named.name}__${tool.name}`),
          )
        : [named.name],
    )
    .join(", ")
}

function limit(value: string, tally: Tally) {
  const redacted = Redact.redact(value)
  if (redacted.length <= OUTPUT_LIMIT) return redacted
  tally.truncated++
  return `${redacted.slice(0, OUTPUT_LIMIT)}\n\n[Output truncated by the ${NAME} import: ${redacted.length - OUTPUT_LIMIT} more characters]`
}

function errorMessage(content: ReadonlyArray<OutputEncoded>) {
  const message = content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join("\n")
    .trim()
  if (!message) return "Tool call failed"
  return message.length > 2_000 ? `${message.slice(0, 2_000)}…` : message
}

/** The user messages a compaction kept in its replacement history, serialized as recent context. */
function retained(history: ReadonlyArray<Item>) {
  const tally = blankTally()
  return history
    .flatMap((item) => {
      if (item.type !== "message" || item.role !== "user") return []
      const prompt = userPrompt(item, tally)
      return prompt?.text ? [`[User]: ${prompt.text}`] : []
    })
    .join("\n\n")
}

/**
 * What the user typed in a user-role message. Codex also sends environment context, AGENTS.md
 * instructions and app context as user messages; newer releases label each content item's kind,
 * and older ones wrap injected context in a leading tag.
 */
function userPrompt(item: Extract<Item, { type: "message" }>, tally: Tally) {
  const kinds = item.internal_chat_message_metadata_passthrough?.content_item_kinds
  const kept = item.content.flatMap((value, index) => {
    const part = Option.getOrUndefined(decodePart(value))
    if (!part) {
      tally.blocks.add(`${partType(value)} in a user message`)
      return []
    }
    const kind = kinds?.[index]
    if (kinds ? !(typeof kind === "string" && kind.startsWith("user.")) : "text" in part && injected(part.text))
      return []
    return [part]
  })
  if (kept.length === 0) {
    if (item.content.length > 0) tally.injected++
    return undefined
  }
  const files = kept.flatMap((part) => {
    if ("text" in part) return []
    const image = inline(part.image_url)
    if (image) return [{ data: image.data, mime: image.mime, source: { type: "inline" as const } }]
    tally.images++
    return []
  })
  const text = kept.flatMap((part) => ("text" in part ? [part.text] : [])).join("\n\n")
  return { text, files }
}

function injected(text: string) {
  const value = text.trimStart()
  return /^<[a-z][\w-]*>/i.test(value) || value.startsWith("# AGENTS.md instructions")
}

function inline(url: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(url)
  return match ? { mime: match[1] ?? "image/png", data: match[2] ?? "" } : undefined
}

function partType(value: unknown) {
  return Option.getOrUndefined(decodePartType(value))?.type ?? "unknown"
}

function blankTally(): Tally {
  return {
    injected: 0,
    developer: 0,
    encrypted: 0,
    summaries: 0,
    compactions: 0,
    messages: 0,
    snapshots: 0,
    truncated: 0,
    interrupted: 0,
    images: 0,
    blocks: new Set(),
  }
}

function firstPrompt(messages: ReadonlyArray<SessionMessage.Info>) {
  const prompt = messages.filter((message) => message.type === "user").find((message) => message.text.trim())
  return prompt ? truncate(prompt.text) : undefined
}

function start(entries: ReadonlyArray<Entry>) {
  return BigInt(millis(entries.find((entry) => entry.timestamp)?.timestamp)) * 0x1000n
}

function millis(timestamp: string | undefined) {
  const value = timestamp ? Date.parse(timestamp) : Number.NaN
  return Number.isFinite(value) ? value : 0
}

function count(value: number, noun: string, plural = `${noun}s`) {
  return `${value} ${value === 1 ? noun : plural}`
}

function truncate(value: string) {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

/** Codex keeps its data in `CODEX_HOME`, which defaults to `~/.codex`. */
export function directories() {
  return [process.env.CODEX_HOME || path.join(os.homedir(), ".codex")]
}

// Thread IDs are UUIDs; anything else must not reach a path.
const REF = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
// `rollout-<local time>-<thread>.jsonl`, or `…-<thread>_<page>.jsonl` for a continuation page.
const ROLLOUT =
  /^rollout-(.+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_([0-9a-f]{8}-[0-9a-f-]{27}))?\.jsonl$/i

interface Rollout {
  readonly path: string
  readonly thread: string
  readonly stamp: string
  /** The continuation page ID; the thread's first file has none. */
  readonly page?: string
}

export function adapter(input: { readonly directories: ReadonlyArray<string> }): ImportSource.Adapter {
  const home = () =>
    input.directories.find(
      (root) => existsSync(path.join(root, "sessions")) || existsSync(path.join(root, "archived_sessions")),
    )
  const store = Effect.fnUntraced(function* () {
    const root = home()
    if (!root)
      return yield* new ImportSource.UnavailableError({ source: "codex", message: "No Codex session store found" })
    return root
  })
  return {
    source: "codex",
    name: NAME,
    detect: Effect.fnUntraced(function* () {
      const root = home()
      const base = { source: "codex" as const, name: NAME }
      if (!root) return { ...base, available: false, sessions: 0, warning: "No Codex session store found" }
      return yield* threads(root).pipe(
        Effect.match({
          onFailure: (error) => ({ ...base, path: root, available: false, sessions: 0, warning: error.message }),
          onSuccess: (found) => ({
            ...base,
            path: root,
            available: true,
            sessions: found.filter((thread) => !isSubagent(thread.meta)).length,
          }),
        }),
      )
    }),
    list: Effect.fnUntraced(function* (options) {
      const root = yield* store()
      const found = yield* threads(root)
      const titles = yield* index(root)
      const candidates = found.filter(
        (thread) =>
          !isSubagent(thread.meta) &&
          (!options.directory || sameDirectory(ImportSource.directory(thread.meta.cwd ?? ""), options.directory)),
      )
      const timed = yield* Effect.forEach(candidates, (thread) =>
        Effect.forEach(thread.files, (file) =>
          attempt(() => stat(file.path)).pipe(Effect.map((info) => ({ ...file, size: info.size, mtime: info.mtimeMs }))),
        ).pipe(Effect.map((files) => ({ ...thread, files, mtime: Math.max(...files.map((file) => file.mtime)) }))),
      )
      const sorted = timed.toSorted((a, b) => b.mtime - a.mtime || a.id.localeCompare(b.id))
      // Read samples newest first, and only until enough threads with a conversation are found.
      const listed: Array<SessionImport.Summary> = []
      for (const thread of sorted) {
        if (listed.length >= options.limit) break
        const item = yield* summary({
          ...thread,
          title: titles.get(thread.id),
          subagents: found.filter((other) => parentOf(other.meta) === thread.id).length,
        })
        if (item) listed.push(item)
      }
      return listed
    }),
    load: Effect.fnUntraced(function* (ref) {
      const root = yield* store()
      const files = REF.test(ref) ? yield* rollouts(root) : []
      const own = files.filter((file) => file.thread === ref)
      const first = own[0]
      if (!first) return yield* new ImportSource.NotFoundError({ source: "codex", ref })
      // Subagent threads start after the session that spawned them, so earlier rollouts are not read.
      const later = files.filter((file) => file.thread !== ref && file.stamp >= first.stamp)
      const heads = yield* Effect.forEach(later, (file) =>
        head(file.path).pipe(Effect.map((meta) => ({ file, meta }))),
      )
      const below = family(
        ref,
        heads.flatMap((item) => (item.meta && !item.file.page ? [[item.file.thread, parentOf(item.meta)] as const] : [])),
      )
      const subagents = yield* Effect.forEach(
        [...Map.groupBy(later.filter((file) => below.has(file.thread)), (file) => file.thread)],
        ([id, pages]) =>
          Effect.map(Effect.forEach(pages, (file) => read(file.path)), (transcripts) => ({ id, pages: transcripts })),
      )
      const titles = yield* index(root)
      const normalized = normalize({
        thread: { id: ref, pages: yield* Effect.forEach(own, (file) => read(file.path)) },
        subagents,
        ...(titles.get(ref) ? { title: titles.get(ref) } : {}),
      })
      if (normalized.sessions[0]?.ref !== ref)
        return yield* new ImportSource.UnavailableError({
          source: "codex",
          message: `${NAME} session ${ref} could not be read`,
        })
      return {
        source: "codex" as const,
        name: NAME,
        path: (own.at(-1) ?? first).path,
        note: TOOL_NOTE,
        sessions: normalized.sessions,
      }
    }),
  }
}

/** The threads descending from `root`, given each thread's parent. */
function family(root: string, parents: ReadonlyArray<readonly [string, string | undefined]>) {
  const found = new Set<string>()
  const visit = (parent: string): void =>
    parents.forEach(([thread, owner]) => {
      if (owner !== parent || thread === root || found.has(thread)) return
      found.add(thread)
      visit(thread)
    })
  visit(root)
  return found
}

/** Every rollout file, active and archived, ordered so each thread's first file precedes its pages. */
function rollouts(root: string) {
  return Effect.gen(function* () {
    const sessions = path.join(root, "sessions")
    const archived = path.join(root, "archived_sessions")
    const names = [
      ...(existsSync(sessions) ? yield* attempt(() => readdir(sessions, { recursive: true })) : []).map((name) =>
        path.join(sessions, name),
      ),
      ...(existsSync(archived) ? yield* attempt(() => readdir(archived)) : []).map((name) => path.join(archived, name)),
    ]
    return names
      .flatMap((file): ReadonlyArray<Rollout> => {
        const match = ROLLOUT.exec(path.basename(file))
        if (!match?.[1] || !match[2]) return []
        return [{ path: file, stamp: match[1], thread: match[2], ...(match[3] ? { page: match[3] } : {}) }]
      })
      .toSorted(
        (a, b) =>
          a.thread.localeCompare(b.thread) ||
          Number(a.page !== undefined) - Number(b.page !== undefined) ||
          (a.page ?? "").localeCompare(b.page ?? "") ||
          a.stamp.localeCompare(b.stamp),
      )
  })
}

/** Every thread with the meta record that opens its first rollout. */
function threads(root: string) {
  return Effect.gen(function* () {
    const files = yield* rollouts(root)
    const grouped = [...Map.groupBy(files, (file) => file.thread)]
    const found = yield* Effect.forEach(grouped, ([id, pages]) =>
      head(pages[0]?.path ?? "").pipe(Effect.map((meta) => (meta ? [{ id, meta, files: pages }] : []))),
    )
    return found.flat()
  })
}

/** The names Codex gave its threads, newest entry last. */
function index(root: string) {
  return Effect.gen(function* () {
    const file = path.join(root, "session_index.jsonl")
    if (!existsSync(file)) return new Map<string, string>()
    const text = yield* attempt(() => Bun.file(file).text())
    return new Map(
      text
        .split("\n")
        .flatMap((line) => Option.toArray(decodeIndex(line)))
        .flatMap((entry) => (entry.thread_name ? [[entry.id, entry.thread_name] as const] : [])),
    )
  })
}

const decodeIndex = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, thread_name: Text })),
)

/** The meta record a rollout opens with, read without the rest of the file. */
function head(file: string) {
  return Effect.gen(function* () {
    const size = Bun.file(file).size
    // The meta record carries the base instructions, so it can outgrow one sample.
    const prefix = (length: number): Effect.Effect<string, ImportSource.UnavailableError> =>
      attempt(() => Bun.file(file).slice(0, length).text()).pipe(
        Effect.flatMap((text) =>
          text.includes("\n") || length >= size ? Effect.succeed(text.split("\n")[0] ?? "") : prefix(length * 4),
        ),
      )
    const line = yield* prefix(SAMPLE)
    const first = parse(line).entries[0]
    return first?.kind === "meta" ? first.meta : undefined
  })
}

/** Read a whole rollout a line at a time; the longest reach hundreds of megabytes. */
function read(file: string) {
  return attempt(async () => {
    const decoder = new TextDecoder()
    const transcripts: Array<Transcript> = []
    // Pieces of a line still being read; a single record can span many chunks.
    const pending: Array<string> = []
    for await (const chunk of Bun.file(file).stream()) {
      const text = decoder.decode(chunk, { stream: true })
      pending.push(text)
      if (!text.includes("\n")) continue
      const lines = pending.splice(0).join("").split("\n")
      pending.push(lines.pop() ?? "")
      // Decode as the file streams so raw lines do not accumulate beside their records.
      transcripts.push(collect(lines))
    }
    transcripts.push(collect([pending.join("") + decoder.decode()]))
    return {
      entries: transcripts.flatMap((transcript) => transcript.entries),
      invalid: transcripts.reduce((total, transcript) => total + transcript.invalid, 0),
    }
  })
}

/**
 * Summarize a thread from the head of its first rollout and the tail of its last, without parsing
 * whole files: long sessions reach hundreds of megabytes. Small threads are counted exactly.
 */
function summary(thread: {
  readonly id: string
  readonly meta: SessionMeta
  readonly files: ReadonlyArray<Rollout & { readonly size: number; readonly mtime: number }>
  readonly mtime: number
  readonly title?: string
  readonly subagents: number
}) {
  return Effect.gen(function* () {
    const first = thread.files[0]
    const last = thread.files.at(-1)
    const size = thread.files.reduce((total, file) => total + file.size, 0)
    const whole = thread.files.length === 1 && size <= 2 * SAMPLE
    const headText = first
      ? yield* attempt(() =>
          Bun.file(first.path)
            .slice(0, whole ? first.size : SAMPLE)
            .text(),
        )
      : ""
    const tailText =
      whole || !last
        ? ""
        : yield* attempt(() =>
            Bun.file(last.path)
              .slice(Math.max(0, last.size - SAMPLE))
              .text(),
          )
    // A sampled chunk may cut its first or last line in two; those lines simply fail to decode.
    const headEntries = parse(headText).entries
    const tailEntries = parse(tailText).entries
    const entries = [...headEntries, ...tailEntries]
    const sampled = messageCount(headEntries) + messageCount(tailEntries)
    // A thread opened and left before its first prompt has nothing to import.
    if (sampled === 0) return undefined
    const model = entries.findLast((entry) => entry.kind === "context" && entry.model)
    const tally = blankTally()
    const prompt = headEntries
      .flatMap((entry) =>
        entry.kind === "item" && entry.item.type === "message" && entry.item.role === "user"
          ? Option.toArray(Option.fromNullishOr(userPrompt(entry.item, tally)?.text))
          : [],
      )
      .find((text) => text.trim())
    const created = millis(thread.meta.timestamp ?? undefined) || millis(entries.find((entry) => entry.timestamp)?.timestamp) || thread.mtime
    return yield* Schema.decodeUnknownEffect(SessionImport.Summary)({
      source: "codex",
      ref: thread.id,
      title: thread.title || (prompt ? truncate(prompt) : `${NAME} session ${thread.id.slice(0, 8)}`),
      directory: ImportSource.directory(thread.meta.cwd ?? ""),
      messages: whole ? sampled : Math.round((sampled * size) / (2 * SAMPLE)),
      subagents: thread.subagents,
      ...(model?.kind === "context" && model.model
        ? { model: `${thread.meta.model_provider || "openai"}/${model.model}` }
        : {}),
      time: { created, updated: Math.max(created, Math.round(thread.mtime)) },
    }).pipe(Effect.mapError(unreadable))
  })
}

/** User prompts, messages from other agents, compactions and model responses, the way an import counts them. */
function messageCount(entries: ReadonlyArray<Entry>) {
  const tally = blankTally()
  return entries.reduce(
    (state, entry) => {
      if (entry.kind === "compacted") return { total: state.total + 1, open: false }
      if (entry.kind === "usage") return { ...state, open: false }
      if (entry.kind !== "item") return state
      const item = entry.item
      if (isCall(item) || item.type === "reasoning" || (item.type === "message" && item.role === "assistant"))
        return state.open ? state : { total: state.total + 1, open: true }
      if (item.type === "agent_message") return { total: state.total + 1, open: false }
      if (item.type === "message" && item.role === "user" && userPrompt(item, tally))
        return { total: state.total + 1, open: false }
      return { ...state, open: false }
    },
    { total: 0, open: false },
  ).total
}

function attempt<A>(run: () => Promise<A>) {
  return Effect.tryPromise({ try: run, catch: unreadable })
}

function unreadable(cause: unknown) {
  return new ImportSource.UnavailableError({
    source: "codex",
    message: `Failed to read the ${NAME} session store: ${cause instanceof Error ? cause.message : String(cause)}`,
  })
}
