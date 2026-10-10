export * as PiImport from "./pi.js"

import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionImport } from "@opencode/schema/session-import"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { sameDirectory } from "@opencode/util/path"
import { Redact } from "@opencode/util/redact"
import { DateTime, Effect, Option, Schema } from "effect"
import { existsSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ToolInterrupted } from "../tool-interrupted.js"
import { ImportSource } from "./source.js"

/**
 * Pi (`pi-mono`'s coding agent) and its fork oh-my-pi keep each session as a JSONL tree of entries
 * linked by `id`/`parentId` under `<agent dir>/sessions/<encoded cwd>/<timestamp>_<session id>.jsonl`.
 * The formats share their entries, message roles and content blocks; oh-my-pi adds a title slot,
 * `/clear` boundaries, externalized image blobs and subagent transcripts, which Pi stores never contain.
 */
export type Source = Extract<SessionImport.Source, "pi" | "omp">

const NAMES = { pi: "Pi", omp: "oh-my-pi" } as const
/** The most text one tool output keeps; tool results store whole file reads and command logs inline. */
export const OUTPUT_LIMIT = 64 * 1024
/** How much of each end of a large session file is read to list it without parsing the whole file. */
const SAMPLE = 256 * 1024

const Usage = Schema.Struct({
  input: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  output: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  cacheRead: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  cacheWrite: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  cost: Schema.optionalKey(Schema.Struct({ total: Schema.optionalKey(Schema.NullOr(Schema.Finite)) })),
})

const Content = Schema.Union([Schema.String, Schema.Array(Schema.Unknown)])

/** A persisted `AgentMessage`, limited to the fields the importer reads. */
const Message = Schema.Struct({
  role: Schema.String,
  content: Schema.optionalKey(Schema.NullOr(Content)),
  provider: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  usage: Schema.optionalKey(Usage),
  stopReason: Schema.optionalKey(Schema.String),
  errorMessage: Schema.optionalKey(Schema.String),
  toolCallId: Schema.optionalKey(Schema.String),
  toolName: Schema.optionalKey(Schema.String),
  isError: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  details: Schema.optionalKey(Schema.Unknown),
  /** Set on prompts the agent injected itself, such as automatic continuations (oh-my-pi). */
  synthetic: Schema.optionalKey(Schema.Boolean),
  /** A shell command the user ran directly (`!command`), which reaches the model as user text. */
  command: Schema.optionalKey(Schema.String),
  output: Schema.optionalKey(Schema.String),
  exitCode: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  excludeFromContext: Schema.optionalKey(Schema.Boolean),
  timestamp: Schema.optionalKey(Schema.Finite),
})
type Message = typeof Message.Type

/** One line of a Pi or oh-my-pi session file, limited to the fields the importer reads. */
export const Entry = Schema.Struct({
  type: Schema.String,
  id: Schema.optionalKey(Schema.String),
  parentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  timestamp: Schema.optionalKey(Schema.String),
  /** Session format version on the header; version 1 files are linear and carry no tree IDs. */
  version: Schema.optionalKey(Schema.Finite),
  cwd: Schema.optionalKey(Schema.String),
  /** The current title, on oh-my-pi's title slot, header and `title_change` entries. */
  title: Schema.optionalKey(Schema.String),
  /** Pi's `session_info` display name; an empty name clears it. */
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  message: Schema.optionalKey(Message),
  summary: Schema.optionalKey(Schema.String),
  firstKeptEntryId: Schema.optionalKey(Schema.String),
  /** Pi records a model change as `provider` and `modelId`; oh-my-pi as one `provider/model` string. */
  provider: Schema.optionalKey(Schema.String),
  modelId: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  /** The agent definition a subagent ran with, on oh-my-pi's `session_init`. */
  agent: Schema.optionalKey(Schema.String),
})
export type Entry = typeof Entry.Type
type Node = Entry & { readonly id: string; readonly parentId: string | null }

const TextBlock = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })
const ThinkingBlock = Schema.Struct({
  type: Schema.Literal("thinking"),
  thinking: Schema.String,
  thinkingSignature: Schema.optionalKey(Schema.String),
  /** Pi keeps a redacted block as an empty thinking block with an encrypted signature. */
  redacted: Schema.optionalKey(Schema.Boolean),
})
const RedactedThinkingBlock = Schema.Struct({ type: Schema.Literal("redactedThinking") })
const ToolCallBlock = Schema.Struct({
  type: Schema.Literal("toolCall"),
  id: Schema.String,
  name: Schema.String,
  arguments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
})
const ImageBlock = Schema.Struct({
  type: Schema.Literal("image"),
  /** Base64 data, or a `blob:sha256:<hash>` reference into oh-my-pi's blob store. */
  data: Schema.String,
  mimeType: Schema.optionalKey(Schema.String),
})
const Block = Schema.Union([TextBlock, ThinkingBlock, RedactedThinkingBlock, ToolCallBlock, ImageBlock]).pipe(
  Schema.toTaggedUnion("type"),
)
type Block = typeof Block.Type
const BlockType = Schema.Struct({ type: Schema.String })
/** oh-my-pi's `task` tool result names the subagents it ran; each one's transcript is `<id>.jsonl`. */
const TaskDetails = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      agent: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
    }),
  ),
})
type TaskResult = (typeof TaskDetails.Type)["results"][number]

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Entry))
const decodeBlock = Schema.decodeUnknownOption(Block)
const decodeBlockType = Schema.decodeUnknownOption(BlockType)
const decodeTask = Schema.decodeUnknownOption(TaskDetails)
const decodeInfo = Schema.decodeOption(Session.Info)
const decodeMessage = Schema.decodeOption(SessionMessage.Info)

const BLOB = /^blob:sha256:([a-f0-9]{64})$/

export interface Transcript {
  readonly records: ReadonlyArray<Entry>
  /** Lines that were not readable records. */
  readonly invalid: number
}

export interface Agent {
  /** The subagent's output ID, which names its transcript; nested subagents are dot-qualified. */
  readonly id: string
  readonly transcript: Transcript
}

export interface Input {
  readonly source: Source
  /** The session ID from the session header, which also ends the file name. */
  readonly sessionId: string
  readonly main: Transcript
  readonly agents: ReadonlyArray<Agent>
  /** Base64 image data by blob hash, for images oh-my-pi moved out of the transcript. */
  readonly blobs?: ReadonlyMap<string, string>
}

export type Normalized = {
  readonly sessions: ReadonlyArray<{
    readonly ref: string
    readonly data: SessionTransfer.Data
    readonly warnings: ReadonlyArray<string>
  }>
}

/** Parse session file text, one JSON record per line; unreadable lines are counted rather than fatal. */
export function parse(text: string): Transcript {
  const lines = text.split("\n").filter((line) => line.trim())
  const records = lines.flatMap((line) => Option.toArray(decodeLine(line)))
  return { records, invalid: lines.length - records.length }
}

/** How each source's tools correspond to Redcode's, for a model that continues an imported session. */
export const TOOL_NOTES: Record<Source, string> = {
  pi: "Pi tools correspond to yours as follows: bash and powershell → shell; read → read; edit → edit; write → write; grep → grep; find and ls → glob. Tools added by Pi extensions may be unavailable.",
  omp: "oh-my-pi tools correspond to yours as follows: bash → shell; read → read; edit → edit; write → write; grep → grep; glob and find → glob; task → subagent; todo → todowrite; fetch → webfetch; ask → question. Tools without a counterpart, including MCP and extension tools, may be unavailable.",
}

/**
 * Normalize one session and its subagents into transfer data, parents before children. Entries form
 * a tree whose active branch ends at the last entry in the file, which is where the source resumes.
 */
export function normalize(input: Input): Normalized {
  const name = NAMES[input.source]
  const header = input.main.records.find((record) => record.type === "session")
  const nodes = tree(input.main.records)
  const leaf = nodes.at(-1)
  // The leaf names the branch, so a continued or rewound session imports as a new snapshot.
  const seed = `${input.source}:${input.sessionId}${leaf ? `:${leaf.id}` : ""}`
  const tasks = new Map(
    input.main.records.concat(input.agents.flatMap((agent) => agent.transcript.records)).flatMap((record) =>
      record.message?.role === "toolResult"
        ? Option.match(decodeTask(record.message.details), {
            onNone: () => [],
            onSome: (details) => details.results.map((result) => [result.id, result] as const),
          })
        : [],
    ),
  )
  const ids = new Map(
    input.agents.map((agent) => [
      agent.id,
      ImportSource.stableID("ses", `${seed}:agent:${agent.id}`, start(agent.transcript.records), true),
    ]),
  )
  const rootID = ImportSource.stableID("ses", seed, start(input.main.records), true)
  const directory = ImportSource.directory(header?.cwd ?? "")
  const base = { source: input.source, name, directory, agentLinks: ids, blobs: input.blobs ?? new Map() }
  const root = session({
    ...base,
    id: rootID,
    seed,
    transcript: input.main,
    agent: "build",
    title: (messages) =>
      title(input.main.records) ?? firstPrompt(messages) ?? `${name} session ${input.sessionId.slice(0, 8)}`,
  })
  const children = parentsFirst(input.agents).map((agent) => {
    const task = tasks.get(agent.id)
    const kind = task?.agent ?? agent.transcript.records.findLast((record) => record.type === "session_init")?.agent
    return {
      ...session({
        ...base,
        id: ids.get(agent.id) ?? "",
        parentID: ids.get(parentAgent(agent.id)) ?? rootID,
        seed: `${seed}:agent:${agent.id}`,
        transcript: agent.transcript,
        agent: kind === "explore" || kind === "scout" ? "explore" : "general",
        title: (messages) =>
          task?.description ??
          title(agent.transcript.records) ??
          firstPrompt(messages) ??
          `${name} subagent ${agent.id}`,
      }),
      ref: `${input.sessionId}/${agent.id}`,
    }
  })
  return {
    sessions: [{ ...root, ref: input.sessionId }, ...children].flatMap((item) =>
      Option.match(item.info, {
        onNone: () => [],
        onSome: (info) => [{ ref: item.ref, data: { info, messages: item.messages }, warnings: item.warnings }],
      }),
    ),
  }
}

/** Tree entries in file order. Version 1 files predate the tree, so each entry follows the previous one. */
function tree(records: ReadonlyArray<Entry>): ReadonlyArray<Node> {
  const linear = (records.find((record) => record.type === "session")?.version ?? 1) < 2
  const entries = records.filter((record) => record.type !== "session" && record.type !== "title")
  return entries.map((entry, index) =>
    linear
      ? {
          ...entry,
          id: entry.id ?? `#${index}`,
          parentId: index > 0 ? (entries[index - 1]?.id ?? `#${index - 1}`) : null,
        }
      : { ...entry, id: entry.id ?? `#${index}`, parentId: entry.parentId ?? null },
  )
}

/** The entries from the root to `leaf`, stopping at a repeated ID so a corrupt cycle cannot loop. */
function branch(nodes: ReadonlyArray<Node>, leaf: Node | undefined) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const trail: Array<Node> = []
  const seen = new Set<string>()
  for (let current = leaf; current && !seen.has(current.id); current = byId.get(current.parentId ?? "")) {
    seen.add(current.id)
    trail.push(current)
  }
  return trail.reverse()
}

/** The current title: oh-my-pi's title slot or latest rename, or Pi's latest session name. */
function title(records: ReadonlyArray<Entry>) {
  const named = records.findLast((record) => record.type === "session_info")
  return (
    records.find((record) => record.type === "title")?.title ||
    records.findLast((record) => record.type === "title_change")?.title ||
    records.find((record) => record.type === "session")?.title ||
    named?.name?.trim() ||
    undefined
  )
}

/** A nested subagent's output ID qualifies its parent's (`Parent.Child`). */
function parentAgent(id: string) {
  return id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : ""
}

/** Subagents ordered so each one follows the subagent that started it. */
function parentsFirst(agents: ReadonlyArray<Agent>) {
  const ids = new Set(agents.map((agent) => agent.id))
  const children = Map.groupBy(agents, (agent) => (ids.has(parentAgent(agent.id)) ? parentAgent(agent.id) : ""))
  const visit = (parent: string): ReadonlyArray<Agent> =>
    (children.get(parent) ?? [])
      .toSorted((a, b) => Number(start(a.transcript.records) - start(b.transcript.records)) || a.id.localeCompare(b.id))
      .flatMap((agent) => [agent, ...visit(agent.id)])
  return visit("")
}

interface Tally {
  system: number
  synthetic: number
  custom: number
  edits: number
  cleared: number
  excluded: number
  signatures: number
  redacted: number
  truncated: number
  interrupted: number
  images: number
  blocks: Set<string>
}

interface Context {
  readonly source: Source
  readonly name: string
  /** Child session IDs by subagent output ID. */
  readonly agentLinks: ReadonlyMap<string, string>
  readonly blobs: ReadonlyMap<string, string>
}

function session(
  input: Context & {
    readonly id: string
    readonly parentID?: string
    readonly seed: string
    readonly transcript: Transcript
    readonly agent: string
    readonly title: (messages: ReadonlyArray<SessionMessage.Info>) => string
    readonly directory: string
  },
) {
  const tally: Tally = {
    system: 0,
    synthetic: 0,
    custom: 0,
    edits: 0,
    cleared: 0,
    excluded: 0,
    signatures: 0,
    redacted: 0,
    truncated: 0,
    interrupted: 0,
    images: 0,
    blocks: new Set(),
  }
  const nodes = tree(input.transcript.records)
  const active = branch(nodes, nodes.at(-1))
  // oh-my-pi's `/clear` starts a fresh model context; what came before it stays in the source only.
  const reset = active.findLastIndex((node) => node.type === "reset_boundary")
  tally.cleared = active.slice(0, reset + 1).filter((node) => node.type === "message").length
  const messages = convert({ ...input, nodes, path: active.slice(reset + 1), tally }).flatMap((encoded) => {
    const decoded = decodeMessage(encoded)
    if (Option.isSome(decoded)) return [decoded.value]
    tally.blocks.add(`unreadable ${encoded.type} message`)
    return []
  })
  const steps = messages.filter((message) => message.type === "assistant")
  const last = steps.at(-1)
  const header = input.transcript.records.find((record) => record.type === "session")
  const created = millis(header?.timestamp) || millis(nodes[0]?.timestamp)
  const info = decodeInfo({
    id: input.id,
    ...(input.parentID ? { parentID: input.parentID } : {}),
    projectID: Project.ID.global,
    agent: input.agent,
    ...(last ? { model: { id: last.model.id, providerID: last.model.providerID } } : {}),
    cost: steps.reduce((total, step) => total + (step.cost ?? 0), 0),
    tokens: steps.reduce(
      (total, step) => ({
        input: total.input + (step.tokens?.input ?? 0),
        output: total.output + (step.tokens?.output ?? 0),
        reasoning: 0,
        cache: {
          read: total.cache.read + (step.tokens?.cache.read ?? 0),
          write: total.cache.write + (step.tokens?.cache.write ?? 0),
        },
      }),
      { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ),
    time: { created, updated: Math.max(created, millis(nodes.at(-1)?.timestamp)) },
    title: input.title(messages),
    location: { directory: input.directory },
  })
  return { info, messages, warnings: warnings(nodes, input.transcript.invalid, tally) }
}

function warnings(nodes: ReadonlyArray<Node>, invalid: number, tally: Tally) {
  const custom = nodes.filter((node) => node.type === "custom").length
  return [
    invalid && `Skipped ${count(invalid, "unreadable line")}`,
    tally.cleared && `Left out ${count(tally.cleared, "message")} from before the last /clear`,
    tally.system && `Dropped ${count(tally.system, "system or developer message")} (prompt and tool declarations)`,
    tally.synthetic && `Dropped ${count(tally.synthetic, "automatic continuation prompt")}`,
    tally.custom && `Dropped ${count(tally.custom, "extension message")}`,
    tally.excluded &&
      `Dropped ${count(tally.excluded, "shell command")} that ${tally.excluded === 1 ? "was" : "were"} kept out of the model's context`,
    tally.edits && `Context edits were not applied (${count(tally.edits, "edit")}); the original messages are imported`,
    tally.signatures &&
      `Dropped the thinking signatures of ${count(tally.signatures, "reasoning block")}; the reasoning text is kept`,
    tally.redacted && `Skipped ${count(tally.redacted, "redacted reasoning block")}`,
    tally.images &&
      `Skipped ${count(tally.images, "image")} that ${tally.images === 1 ? "was" : "were"} not inline or not in the blob store`,
    tally.truncated && `Truncated ${count(tally.truncated, "tool output")} above 64 KB`,
    tally.interrupted && `Marked ${count(tally.interrupted, "tool call")} without a result as interrupted`,
    tally.blocks.size > 0 && `Skipped unsupported content: ${[...tally.blocks].toSorted().join(", ")}`,
    custom > 0 && `Extension state was not imported (${count(custom, "record")})`,
    nodes.some((node) => node.type === "mode_change") && "Mode changes such as plan mode were not imported",
  ].filter((warning): warning is string => typeof warning === "string")
}

type Encoded = (typeof SessionMessage.Info)["Encoded"]
type ToolEncoded = Extract<(typeof SessionMessage.AssistantContent)["Encoded"], { type: "tool" }>
type ContentEncoded = (typeof SessionMessage.ToolStateCompleted)["Encoded"]["content"][number]
type ToolResult = { readonly message: Message; readonly entry: Node }

/** Convert the active branch into Redcode messages. */
function convert(
  input: Context & {
    readonly seed: string
    readonly nodes: ReadonlyArray<Node>
    readonly path: ReadonlyArray<Node>
    readonly agent: string
    readonly tally: Tally
  },
): ReadonlyArray<Encoded> {
  const tally = input.tally
  const onPath = new Set(input.path.map((node) => node.id))
  // A result recorded on another branch still answers the call, but one on the active branch wins.
  const results = new Map<string, ToolResult>()
  input.nodes
    .filter((node) => node.message?.role === "toolResult" && node.message.toolCallId)
    .toSorted((a, b) => Number(onPath.has(b.id)) - Number(onPath.has(a.id)))
    .forEach((node) => {
      const id = node.message?.toolCallId ?? ""
      if (node.message && !results.has(id)) results.set(id, { message: node.message, entry: node })
    })
  const ids = ImportSource.messageIDs(input.seed)
  return input.path.flatMap((node, index): ReadonlyArray<Encoded> => {
    const at = millis(node.timestamp)
    if (node.type === "compaction")
      return [
        {
          id: ids(node.id, at),
          type: "compaction",
          status: "completed",
          reason: "auto",
          summary: node.summary ?? "",
          recent: recent(input.path.slice(0, index), node.firstKeptEntryId, input),
          time: { created: at },
        },
      ]
    if (node.type === "branch_summary")
      return node.summary
        ? [
            {
              id: ids(node.id, at),
              type: "system",
              text: `The user returned here from another branch of this conversation, summarized as follows:\n\n${node.summary}`,
              description: "Summary of an abandoned branch",
              time: { created: at },
            },
          ]
        : []
    if (node.type === "custom_message") {
      tally.custom++
      return []
    }
    if (node.type === "context_edit") {
      tally.edits++
      return []
    }
    const message = node.message
    if (node.type !== "message" || !message) return []
    const created = message.timestamp ?? at
    if (message.role === "assistant")
      return [step({ ...input, id: ids(node.id, created), message, entry: node, results })]
    if (message.role === "toolResult") return []
    if (message.role === "user") {
      if (message.synthetic) {
        tally.synthetic++
        return []
      }
      const prompt = text(message.content, tally)
      const files = images(message.content, input)
      if (!prompt && files.length === 0) return []
      return [
        {
          id: ids(node.id, created),
          type: "user",
          text: prompt,
          ...(files.length > 0 ? { files } : {}),
          time: { created },
        },
      ]
    }
    if (message.role === "bashExecution") {
      if (message.excludeFromContext) {
        tally.excluded++
        return []
      }
      const exit = typeof message.exitCode === "number" ? ` (exit code ${message.exitCode})` : ""
      return [
        {
          id: ids(node.id, created),
          type: "user",
          text: `I ran \`${message.command ?? ""}\`${exit}:\n\n${limit(message.output ?? "", input)}`,
          time: { created },
        },
      ]
    }
    if (message.role === "system" || message.role === "developer") {
      tally.system++
      return []
    }
    if (message.role === "custom" || message.role === "hookMessage") {
      tally.custom++
      return []
    }
    tally.blocks.add(`${message.role} message`)
    return []
  })
}

/** One assistant step from one model response; Pi records each response as one message. */
function step(
  input: Context & {
    readonly id: string
    readonly agent: string
    readonly message: Message
    readonly entry: Node
    readonly results: ReadonlyMap<string, ToolResult>
    readonly tally: Tally
  },
): Encoded {
  const tally = input.tally
  const message = input.message
  const created = message.timestamp ?? millis(input.entry.timestamp)
  const content = blocks(message.content, tally).flatMap(
    (block): ReadonlyArray<(typeof SessionMessage.AssistantContent)["Encoded"]> => {
      if (block.type === "text") return block.text ? [{ type: "text", text: block.text }] : []
      if (block.type === "redactedThinking" || (block.type === "thinking" && block.redacted)) {
        tally.redacted++
        return []
      }
      if (block.type === "thinking") {
        if (block.thinkingSignature) tally.signatures++
        return block.thinking ? [{ type: "reasoning", text: block.thinking }] : []
      }
      if (block.type === "toolCall") return [tool({ ...input, block, created })]
      tally.blocks.add(`${block.type} in an assistant message`)
      return []
    },
  )
  const usage = message.usage
  const finish = FINISH[message.stopReason ?? ""]
  const failed = message.stopReason === "error" || message.stopReason === "aborted"
  return {
    id: input.id,
    type: "assistant",
    agent: input.agent,
    model: { id: message.model ?? "unknown", providerID: message.provider ?? "unknown" },
    content,
    ...(finish ? { finish } : {}),
    ...(failed
      ? {
          error: {
            type: message.stopReason === "aborted" ? "aborted" : "provider",
            message: message.errorMessage || (message.stopReason === "aborted" ? "Request aborted" : "Request failed"),
          },
        }
      : {}),
    ...(usage?.cost?.total ? { cost: usage.cost.total } : {}),
    ...(usage
      ? {
          tokens: {
            input: usage.input ?? 0,
            output: usage.output ?? 0,
            reasoning: 0,
            cache: { read: usage.cacheRead ?? 0, write: usage.cacheWrite ?? 0 },
          },
        }
      : {}),
    time: { created, completed: Math.max(created, millis(input.entry.timestamp)) },
  }
}

const FINISH: Record<string, "stop" | "length" | "tool-calls" | "error"> = {
  stop: "stop",
  length: "length",
  toolUse: "tool-calls",
  error: "error",
}

function tool(
  input: Context & {
    readonly block: Extract<Block, { type: "toolCall" }>
    readonly created: number
    readonly results: ReadonlyMap<string, ToolResult>
    readonly tally: Tally
  },
): ToolEncoded {
  const args = input.block.arguments ?? {}
  const base = { type: "tool" as const, id: input.block.id, name: input.block.name }
  const result = input.results.get(input.block.id)
  if (!result) {
    // A call left without a result was cut off, whether or not the session continued after it.
    input.tally.interrupted++
    return {
      ...base,
      state: { status: "error", input: args, error: { type: "aborted", message: ToolInterrupted.MESSAGE } },
      time: { created: input.created },
    }
  }
  // A batch `task` call runs several subagents; the first one imported is the call's linked session.
  const child = Option.getOrUndefined(
    Option.flatMap(decodeTask(result.message.details), (details) =>
      Option.fromNullishOr(
        details.results.map((item: TaskResult) => input.agentLinks.get(item.id)).find((id) => id !== undefined),
      ),
    ),
  )
  const content = output(result.message.content, input)
  const metadata = child ? { metadata: { sessionID: child } } : {}
  const completed = Math.max(input.created, result.message.timestamp ?? millis(result.entry.timestamp))
  const time = { created: input.created, completed }
  if (result.message.isError)
    return {
      ...base,
      state: {
        status: "error",
        input: args,
        error: { type: "tool", message: errorMessage(content) },
        content,
        ...metadata,
      },
      time,
    }
  return { ...base, state: { status: "completed", input: args, content, ...metadata }, time }
}

/** A tool result's model-visible output, with secrets redacted and oversized text truncated. */
function output(
  value: Message["content"],
  input: Context & { readonly tally: Tally },
): [ContentEncoded, ...Array<ContentEncoded>] {
  const items = blocks(value, input.tally).flatMap((block): ReadonlyArray<ContentEncoded> => {
    if (block.type === "text") return [{ type: "text", text: limit(block.text, input) }]
    if (block.type === "image") {
      const data = imageData(block, input)
      const mime = block.mimeType ?? "image/png"
      return data ? [{ type: "file", uri: `data:${mime};base64,${data}`, mime }] : []
    }
    input.tally.blocks.add(`${block.type} in a tool result`)
    return []
  })
  const [head, ...rest] = items
  return head ? [head, ...rest] : [{ type: "text", text: "(no output)" }]
}

function limit(value: string, input: Context & { readonly tally: Tally }) {
  const redacted = Redact.redact(value)
  if (redacted.length <= OUTPUT_LIMIT) return redacted
  input.tally.truncated++
  return `${redacted.slice(0, OUTPUT_LIMIT)}\n\n[Output truncated by the ${input.name} import: ${redacted.length - OUTPUT_LIMIT} more characters]`
}

function errorMessage(content: ReadonlyArray<ContentEncoded>) {
  const message = content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join("\n")
    .trim()
  if (!message) return "Tool call failed"
  return message.length > 2_000 ? `${message.slice(0, 2_000)}…` : message
}

/** The entries a compaction kept verbatim, from its first kept entry up to the compaction itself. */
function recent(
  before: ReadonlyArray<Node>,
  firstKept: string | undefined,
  input: Context & { readonly tally: Tally },
) {
  const head = before.findIndex((node) => node.id === firstKept)
  if (head < 0) return ""
  return before
    .slice(head)
    .flatMap((node) => {
      const message = node.message
      if (node.type !== "message" || !message) return []
      if (message.role === "user" && !message.synthetic) {
        const value = text(message.content, input.tally)
        return value ? [`[User]: ${value}`] : []
      }
      if (message.role !== "assistant") return []
      return blocks(message.content, input.tally).flatMap((block) =>
        block.type === "text" && block.text ? [`[Assistant]: ${block.text}`] : [],
      )
    })
    .join("\n\n")
}

function blocks(content: Message["content"], tally: Tally): ReadonlyArray<Block> {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : []
  return (content ?? []).flatMap((item) => {
    const decoded = decodeBlock(item)
    if (Option.isSome(decoded)) return [decoded.value]
    tally.blocks.add(`${Option.getOrUndefined(decodeBlockType(item))?.type ?? "unknown"} block`)
    return []
  })
}

function text(content: Message["content"], tally: Tally) {
  return blocks(content, tally)
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n")
}

function images(content: Message["content"], input: Context & { readonly tally: Tally }) {
  return blocks(content, input.tally).flatMap((block) => {
    if (block.type !== "image") return []
    const data = imageData(block, input)
    return data ? [{ data, mime: block.mimeType ?? "image/png", source: { type: "inline" as const } }] : []
  })
}

/** Inline base64 data, resolving oh-my-pi's blob references through the blobs read at load time. */
function imageData(block: Extract<Block, { type: "image" }>, input: Context & { readonly tally: Tally }) {
  const hash = BLOB.exec(block.data)?.[1]
  const data = hash ? input.blobs.get(hash) : block.data
  if (data) return data
  input.tally.images++
  return undefined
}

function firstPrompt(messages: ReadonlyArray<SessionMessage.Info>) {
  const prompt = messages
    .filter((message) => message.type === "user")
    .find((message) => message.text.trim() && !message.text.trimStart().startsWith("<"))
  return prompt ? truncate(prompt.text) : undefined
}

function start(records: ReadonlyArray<Entry>) {
  return BigInt(millis(records.find((record) => record.timestamp)?.timestamp)) * 0x1000n
}

function millis(timestamp: string | undefined) {
  const value = timestamp ? Date.parse(timestamp) : Number.NaN
  return Number.isFinite(value) ? value : 0
}

function count(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`
}

/**
 * The session store roots each source writes to, most specific first. Pi honors
 * `PI_CODING_AGENT_SESSION_DIR` and `PI_CODING_AGENT_DIR`; oh-my-pi reads the same variable names,
 * so they are Pi's here, and oh-my-pi is found through `PI_CONFIG_DIR` (default `~/.omp`) or, on
 * Linux, its XDG data directory.
 */
export function directories(source: Source) {
  const home = (value: string) => value.replace(/^~(?=$|[\\/])/, os.homedir())
  if (source === "pi")
    return [
      process.env.PI_CODING_AGENT_SESSION_DIR && home(process.env.PI_CODING_AGENT_SESSION_DIR),
      process.env.PI_CODING_AGENT_DIR && path.join(home(process.env.PI_CODING_AGENT_DIR), "sessions"),
      path.join(os.homedir(), ".pi", "agent", "sessions"),
    ].filter((dir): dir is string => Boolean(dir))
  return [
    process.platform === "linux" &&
      process.env.XDG_DATA_HOME &&
      path.join(process.env.XDG_DATA_HOME, "omp", "sessions"),
    path.join(os.homedir(), process.env.PI_CONFIG_DIR || ".omp", "agent", "sessions"),
  ].filter((dir): dir is string => Boolean(dir))
}

// Session IDs are UUIDs or caller-chosen IDs of these characters; anything else must not reach a path.
const REF = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** An adapter for one of the two sources, reading the first of `directories` that exists. */
export function adapter(input: {
  readonly source: Source
  readonly directories: ReadonlyArray<string>
}): ImportSource.Adapter {
  const source = input.source
  const name = NAMES[source]
  const missing = `No ${name} session store found`
  const fail = (cause: unknown) =>
    new ImportSource.UnavailableError({
      source,
      message: `Failed to read the ${name} session store: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
  const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: fail })
  const root = () => input.directories.find((dir) => existsSync(dir))
  const store = Effect.fnUntraced(function* () {
    const dir = root()
    if (!dir) return yield* new ImportSource.UnavailableError({ source, message: missing })
    return dir
  })

  /** Top-level session files: `<root>/<bucket>/*.jsonl`, or flat in a custom session directory. */
  const files = (dir: string) =>
    Effect.gen(function* () {
      const listing = (folder: string) =>
        attempt(() => readdir(folder, { withFileTypes: true })).pipe(
          Effect.map((entries) =>
            entries
              .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
              .map((entry) => ({
                ref: refOf(entry.name),
                bucket: path.basename(folder),
                path: path.join(folder, entry.name),
              })),
          ),
        )
      const entries = yield* attempt(() => readdir(dir, { withFileTypes: true }))
      const names = new Set(entries.map((entry) => entry.name))
      // A session's artifacts directory sits next to its file and holds subagent transcripts.
      const buckets = entries.filter((entry) => entry.isDirectory() && !names.has(`${entry.name}.jsonl`))
      const nested = yield* Effect.forEach(buckets, (bucket) => listing(path.join(dir, bucket.name)))
      return [...(yield* listing(dir)), ...nested.flat()].filter((file) => REF.test(file.ref))
    })

  /** A session file's first and last records and its size, without parsing the whole file. */
  const summary = (file: {
    readonly ref: string
    readonly path: string
    readonly size: number
    readonly mtime: number
  }) =>
    Effect.gen(function* () {
      const whole = file.size <= 2 * SAMPLE
      const head = yield* attempt(() =>
        Bun.file(file.path)
          .slice(0, whole ? file.size : SAMPLE)
          .text(),
      )
      const tail = whole
        ? ""
        : yield* attempt(() =>
            Bun.file(file.path)
              .slice(file.size - SAMPLE)
              .text(),
          )
      // A sampled chunk may cut its first or last line in two; those lines simply fail to decode.
      const first = parse(head).records
      const last = parse(tail).records
      const records = [...first, ...last]
      const header = first.find((record) => record.type === "session")
      if (!header) return undefined
      const conversational = records.filter(
        (record) =>
          record.message?.role === "assistant" || (record.message?.role === "user" && !record.message.synthetic),
      )
      if (conversational.length === 0) return undefined
      const reply = records.findLast((record) => record.message?.role === "assistant" && record.message.model)?.message
      const prompt = first.find((record) => record.message?.role === "user" && !record.message.synthetic)
      const promptText = prompt?.message ? plain(prompt.message.content) : ""
      const created = Math.round(millis(header.timestamp) || file.mtime)
      // The newest recorded entry time, which survives copies and restores that reset the file's mtime.
      const updated = Math.round(millis(records.findLast((record) => record.timestamp)?.timestamp) || file.mtime)
      const subagents = yield* attempt(() => readdir(file.path.slice(0, -".jsonl".length))).pipe(
        Effect.map((names) => names.filter((item) => item.endsWith(".jsonl")).length),
        Effect.orElseSucceed(() => 0),
      )
      return yield* Schema.decodeUnknownEffect(SessionImport.Summary)({
        source,
        ref: file.ref,
        title: title(records) ?? (promptText ? truncate(promptText) : `${name} session ${file.ref.slice(0, 8)}`),
        directory: ImportSource.directory(header.cwd ?? ""),
        messages: whole ? conversational.length : Math.round((conversational.length * file.size) / (2 * SAMPLE)),
        subagents,
        ...(reply?.model ? { model: reply.provider ? `${reply.provider}/${reply.model}` : reply.model } : {}),
        time: { created, updated: Math.max(created, updated) },
      }).pipe(Effect.mapError(fail))
    })

  return {
    source,
    name,
    detect: Effect.fnUntraced(function* () {
      const dir = root()
      const base = { source, name }
      if (!dir) return { ...base, available: false, sessions: 0, warning: missing }
      return yield* files(dir).pipe(
        Effect.match({
          onFailure: (error) => ({ ...base, path: dir, available: false, sessions: 0, warning: error.message }),
          onSuccess: (found) => ({ ...base, path: dir, available: true, sessions: found.length }),
        }),
      )
    }),
    list: Effect.fnUntraced(function* (options) {
      const dir = yield* store()
      const found = yield* files(dir)
      // Bucket names are lossy encodings of the directory, so they only narrow the candidates.
      const encoded = options.directory ? buckets(options.directory) : []
      const narrowed = found.filter((file) => encoded.includes(file.bucket.toLowerCase()))
      const candidates = narrowed.length > 0 ? narrowed : found
      const timed = yield* Effect.forEach(candidates, (file) =>
        attempt(() => stat(file.path)).pipe(Effect.map((info) => ({ ...file, size: info.size, mtime: info.mtimeMs }))),
      )
      // The modification time only decides which headers to read first, newest first, and only until enough
      // sessions in the directory are found. Files written within one timestamp tick tie, so the result is
      // ordered by the time each session records.
      const sorted = timed.toSorted((a, b) => b.mtime - a.mtime || a.ref.localeCompare(b.ref))
      const result: Array<SessionImport.Summary> = []
      for (const file of sorted) {
        if (result.length >= options.limit) break
        const item = yield* summary(file)
        if (item && (!options.directory || sameDirectory(item.directory, options.directory))) result.push(item)
      }
      return result.toSorted(
        (a, b) =>
          DateTime.toEpochMillis(b.time.updated) - DateTime.toEpochMillis(a.time.updated) || a.ref.localeCompare(b.ref),
      )
    }),
    load: Effect.fnUntraced(function* (ref) {
      const dir = yield* store()
      const file = REF.test(ref) ? (yield* files(dir)).find((item) => item.ref === ref) : undefined
      if (!file) return yield* new ImportSource.NotFoundError({ source, ref })
      const main = parse(yield* attempt(() => Bun.file(file.path).text()))
      const artifacts = file.path.slice(0, -".jsonl".length)
      const names = existsSync(artifacts)
        ? (yield* attempt(() => readdir(artifacts))).filter((item) => item.endsWith(".jsonl"))
        : []
      const agents = yield* Effect.forEach(names, (item) =>
        attempt(() => Bun.file(path.join(artifacts, item)).text()).pipe(
          Effect.map((text) => ({ id: item.slice(0, -".jsonl".length), transcript: parse(text) })),
        ),
      )
      const blobs = yield* readBlobs(path.join(dir, "..", "blobs"), [main, ...agents.map((agent) => agent.transcript)])
      const normalized = normalize({ source, sessionId: ref, main, agents, blobs })
      if (normalized.sessions[0]?.ref !== ref)
        return yield* new ImportSource.UnavailableError({ source, message: `${name} session ${ref} could not be read` })
      return { source, name, path: file.path, note: TOOL_NOTES[source], sessions: normalized.sessions }
    }),
  }

  /** Read the image blobs the transcripts reference; a missing blob leaves its image out. */
  function readBlobs(dir: string, transcripts: ReadonlyArray<Transcript>) {
    const hashes = new Set(
      transcripts.flatMap((transcript) =>
        transcript.records.flatMap((record) => {
          const content = record.message?.content
          return typeof content === "string" || !content
            ? []
            : content.flatMap((item) =>
                Option.match(decodeBlock(item), {
                  onNone: () => [],
                  onSome: (block) => {
                    const hash = block.type === "image" ? BLOB.exec(block.data)?.[1] : undefined
                    return hash ? [hash] : []
                  },
                }),
              )
        }),
      ),
    )
    return Effect.forEach([...hashes], (hash) =>
      attempt(() => Bun.file(path.join(dir, hash)).bytes()).pipe(
        Effect.map((bytes) => [[hash, Buffer.from(bytes).toString("base64")] as const]),
        Effect.orElseSucceed(() => []),
      ),
    ).pipe(Effect.map((pairs) => new Map(pairs.flat())))
  }
}

/** The session ID a file holds, which follows the creation timestamp in `<timestamp>_<id>.jsonl`. */
function refOf(file: string) {
  const stem = file.slice(0, -".jsonl".length)
  return stem.includes("_") ? stem.slice(stem.indexOf("_") + 1) : stem
}

/**
 * The bucket names a directory's sessions may be filed under: Pi's `--<path>--` and oh-my-pi's
 * `-<path relative to home>` for directories inside the home directory.
 */
function buckets(directory: string) {
  const encode = (value: string) => value.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")
  const relative = path.relative(os.homedir(), directory)
  const inside = relative && !relative.startsWith("..") && !path.isAbsolute(relative)
  return [`--${encode(directory)}--`, ...(inside ? [`-${encode(relative)}`] : [])].map((name) => name.toLowerCase())
}

function plain(content: Message["content"]) {
  if (typeof content === "string") return content.trimStart().startsWith("<") ? "" : content
  return (content ?? [])
    .flatMap((item) =>
      Option.match(decodeBlock(item), {
        onNone: () => [],
        onSome: (block) => (block.type === "text" && !block.text.trimStart().startsWith("<") ? [block.text] : []),
      }),
    )
    .join(" ")
}

function truncate(value: string) {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}
