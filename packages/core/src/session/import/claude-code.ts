export * as ClaudeCodeImport from "./claude-code.js"

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

const NAME = "Claude Code"
/** The most text one tool output keeps; Claude Code stores whole file reads and command logs inline. */
export const OUTPUT_LIMIT = 64 * 1024
/** How much of each end of a large transcript is read to list it without parsing the whole file. */
const SAMPLE = 256 * 1024

const Usage = Schema.Struct({
  input_tokens: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  output_tokens: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  cache_read_input_tokens: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  cache_creation_input_tokens: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
})

/** One line of a Claude Code transcript, limited to the fields the importer reads. */
export const Entry = Schema.Struct({
  type: Schema.String,
  subtype: Schema.optionalKey(Schema.String),
  uuid: Schema.optionalKey(Schema.String),
  parentUuid: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** Set on a compaction boundary, whose `parentUuid` is null, to the record the conversation continued from. */
  logicalParentUuid: Schema.optionalKey(Schema.NullOr(Schema.String)),
  isSidechain: Schema.optionalKey(Schema.Boolean),
  isMeta: Schema.optionalKey(Schema.Boolean),
  isCompactSummary: Schema.optionalKey(Schema.Boolean),
  agentId: Schema.optionalKey(Schema.String),
  cwd: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  timestamp: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(
    Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      model: Schema.optionalKey(Schema.String),
      content: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.Unknown)])),
      stop_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
      usage: Schema.optionalKey(Usage),
    }),
  ),
  toolUseResult: Schema.optionalKey(Schema.Unknown),
  customTitle: Schema.optionalKey(Schema.String),
  aiTitle: Schema.optionalKey(Schema.String),
  leafUuid: Schema.optionalKey(Schema.String),
  totalCostUSD: Schema.optionalKey(Schema.Finite),
  attachment: Schema.optionalKey(
    Schema.Struct({
      type: Schema.String,
      prompt: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.Unknown)])),
      commandMode: Schema.optionalKey(Schema.String),
      isMeta: Schema.optionalKey(Schema.Boolean),
      origin: Schema.optionalKey(Schema.Struct({ kind: Schema.optionalKey(Schema.String) })),
    }),
  ),
  compactMetadata: Schema.optionalKey(
    Schema.Struct({
      trigger: Schema.optionalKey(Schema.String),
      preservedSegment: Schema.optionalKey(Schema.Struct({ headUuid: Schema.String, tailUuid: Schema.String })),
    }),
  ),
})
export type Entry = typeof Entry.Type
type Node = Entry & { readonly uuid: string }

/** The sidecar Claude Code writes next to a subagent transcript. */
export const AgentMeta = Schema.Struct({
  agentType: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  /** The parent's Task/Agent tool call that started the subagent. */
  toolUseId: Schema.optionalKey(Schema.String),
  /** The subagent that started this one, for nested subagents. */
  parentAgentId: Schema.optionalKey(Schema.String),
})
export type AgentMeta = typeof AgentMeta.Type

const TextBlock = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })
const ThinkingBlock = Schema.Struct({
  type: Schema.Literal("thinking"),
  thinking: Schema.String,
  signature: Schema.optionalKey(Schema.String),
})
const RedactedThinkingBlock = Schema.Struct({ type: Schema.Literal("redacted_thinking") })
const ToolUseBlock = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Record(Schema.String, Schema.Unknown),
})
const ImageBlock = Schema.Struct({
  type: Schema.Literal("image"),
  source: Schema.Struct({
    type: Schema.String,
    media_type: Schema.optionalKey(Schema.String),
    data: Schema.optionalKey(Schema.String),
  }),
})
const ToolResultBlock = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.String,
  content: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]))),
  is_error: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
})
const Block = Schema.Union([
  TextBlock,
  ThinkingBlock,
  RedactedThinkingBlock,
  ToolUseBlock,
  ImageBlock,
  ToolResultBlock,
]).pipe(Schema.toTaggedUnion("type"))
type Block = typeof Block.Type
type ToolResult = typeof ToolResultBlock.Type
const BlockType = Schema.Struct({ type: Schema.String })
const AgentResult = Schema.Struct({ agentId: Schema.String })

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Entry))
const decodeBlock = Schema.decodeUnknownOption(Block)
const decodeBlockType = Schema.decodeUnknownOption(BlockType)
const decodeAgentResult = Schema.decodeUnknownOption(AgentResult)
const decodeMeta = Schema.decodeUnknownOption(Schema.fromJsonString(AgentMeta))
const decodeInfo = Schema.decodeOption(Session.Info)
const decodeMessage = Schema.decodeOption(SessionMessage.Info)

export interface Transcript {
  readonly records: ReadonlyArray<Entry>
  /** Lines that were not readable records. */
  readonly invalid: number
}

export interface Agent {
  readonly id: string
  readonly meta?: AgentMeta
  readonly transcript: Transcript
}

export interface Input {
  /** The Claude Code session ID, which names the transcript file. */
  readonly sessionId: string
  readonly main: Transcript
  readonly agents: ReadonlyArray<Agent>
}

export type Normalized = {
  readonly sessions: ReadonlyArray<{
    readonly ref: string
    readonly version?: string
    readonly data: SessionTransfer.Data
    readonly warnings: ReadonlyArray<string>
  }>
}

/** Parse transcript text, one JSON record per line; unreadable lines are counted rather than fatal. */
export function parse(text: string): Transcript {
  const lines = text.split("\n").filter((line) => line.trim())
  const records = lines.flatMap((line) => Option.toArray(decodeLine(line)))
  return { records, invalid: lines.length - records.length }
}

/** How Claude Code's tools correspond to Redcode's, for a model that continues an imported session. */
export const TOOL_NOTE =
  "Claude Code tools correspond to yours as follows: Bash and PowerShell → shell; Read → read; Edit, MultiEdit and NotebookEdit → edit; Write → write; Glob → glob; Grep → grep; Task and Agent → subagent; TodoWrite → todowrite; WebFetch → webfetch; WebSearch → websearch; AskUserQuestion → question; Skill → skill. Tools without a counterpart, including MCP tools, may be unavailable."

/**
 * Normalize one Claude Code session and its subagents into transfer data, parents before children.
 * Records form a tree; the active branch is the one ending at the newest record that descends from
 * the recorded last prompt.
 */
export function normalize(input: Input): Normalized {
  const records = input.main.records.filter((record) => !record.isSidechain)
  const leaf = activeLeaf(records)
  // The leaf names the branch, so a continued or rewound session imports as a new snapshot.
  const seed = `claude-code:${input.sessionId}${leaf ? `:${leaf.uuid}` : ""}`
  const agents = [...input.agents, ...inlineSidechains(input)]
  const ids = new Map(
    agents.map((agent) => [
      agent.id,
      ImportSource.stableID("ses", `${seed}:agent:${agent.id}`, start(agent.transcript.records), true),
    ]),
  )
  const links = new Map(
    agents.flatMap((agent) =>
      agent.meta?.toolUseId ? [[agent.meta.toolUseId, ids.get(agent.id) ?? ""] as const] : [],
    ),
  )
  const rootID = ImportSource.stableID("ses", seed, start(records), true)
  const directory = ImportSource.directory(records.find((record) => record.cwd)?.cwd ?? "")
  const root = session({
    id: rootID,
    seed,
    records,
    leaf,
    invalid: input.main.invalid,
    agent: "build",
    title: (conversation) =>
      records.findLast((record) => record.customTitle)?.customTitle ??
      records.findLast((record) => record.aiTitle)?.aiTitle ??
      firstPrompt(conversation) ??
      `${NAME} session ${input.sessionId.slice(0, 8)}`,
    directory,
    cost: records.findLast((record) => record.totalCostUSD !== undefined)?.totalCostUSD ?? 0,
    links,
    agentLinks: ids,
  })
  const children = parentsFirst(agents).map((agent) => {
    const agentRecords = agent.transcript.records
    return {
      ...session({
        id: ids.get(agent.id) ?? "",
        parentID: (agent.meta?.parentAgentId && ids.get(agent.meta.parentAgentId)) || rootID,
        seed: `${seed}:agent:${agent.id}`,
        records: agentRecords,
        leaf: agentRecords.findLast((record): record is Node => record.uuid !== undefined),
        invalid: agent.transcript.invalid,
        agent: agent.meta?.agentType?.toLowerCase() === "explore" ? "explore" : "general",
        title: (conversation) =>
          agent.meta?.description ?? firstPrompt(conversation) ?? `${NAME} subagent ${agent.id.slice(0, 8)}`,
        directory,
        cost: 0,
        links,
        agentLinks: ids,
      }),
      ref: `${input.sessionId}/agent-${agent.id}`,
    }
  })
  return {
    sessions: [{ ...root, ref: input.sessionId }, ...children].flatMap((item) =>
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

/** Older Claude Code releases kept subagent sidechains in the session file instead of their own files. */
function inlineSidechains(input: Input): ReadonlyArray<Agent> {
  const known = new Set(input.agents.map((agent) => agent.id))
  const groups = Map.groupBy(
    input.main.records.filter((record) => record.isSidechain),
    (record) => record.agentId ?? "sidechain",
  )
  return [...groups]
    .filter(([id]) => !known.has(id))
    .map(([id, records]) => ({ id, transcript: { records, invalid: 0 } }))
}

/** Subagents ordered so each one follows the subagent that started it. */
function parentsFirst(agents: ReadonlyArray<Agent>) {
  const ids = new Set(agents.map((agent) => agent.id))
  const children = Map.groupBy(agents, (agent) =>
    agent.meta?.parentAgentId && ids.has(agent.meta.parentAgentId) ? agent.meta.parentAgentId : "",
  )
  const visit = (parent: string): ReadonlyArray<Agent> =>
    (children.get(parent) ?? [])
      .toSorted((a, b) => Number(start(a.transcript.records) - start(b.transcript.records)) || a.id.localeCompare(b.id))
      .flatMap((agent) => [agent, ...visit(agent.id)])
  return visit("")
}

/**
 * The record that ends the active branch. Claude Code records the last prompt's leaf but keeps
 * appending the reply after it, so the newest record descending from that leaf ends the branch;
 * without a recorded leaf, the newest record does.
 */
function activeLeaf(records: ReadonlyArray<Entry>) {
  const nodes = records.filter((record): record is Node => record.uuid !== undefined)
  const known = new Set(nodes.map((node) => node.uuid))
  const recorded = records.findLast((record) => record.type === "last-prompt" && known.has(record.leafUuid ?? ""))
  if (!recorded?.leafUuid) return nodes.at(-1)
  // Records are appended after their parents, so one pass in file order collects the descendants.
  const below = nodes.reduce(
    (set, node) => (set.has(parentOf(node)) ? set.add(node.uuid) : set),
    new Set([recorded.leafUuid]),
  )
  return nodes.findLast((node) => below.has(node.uuid))
}

/** A compaction boundary has no parent; the conversation it summarizes continues from its logical parent. */
function parentOf(record: Entry) {
  return record.parentUuid ?? record.logicalParentUuid ?? ""
}

/** The records from the root to `leaf`, following the newest copy of each rewritten record. */
function branch(records: ReadonlyArray<Entry>, leaf: Node | undefined) {
  const byUuid = new Map(records.flatMap((record) => (record.uuid ? [[record.uuid, record] as const] : [])))
  const trail: Array<Entry> = []
  const seen = new Set<string>()
  for (let current = leaf && byUuid.get(leaf.uuid); current?.uuid && !seen.has(current.uuid); ) {
    seen.add(current.uuid)
    trail.push(current)
    current = byUuid.get(parentOf(current))
  }
  return trail.reverse()
}

interface Tally {
  attachments: number
  meta: number
  system: number
  synthetic: number
  signatures: number
  redacted: number
  truncated: number
  interrupted: number
  images: number
  blocks: Set<string>
}

function session(input: {
  readonly id: string
  readonly parentID?: string
  readonly seed: string
  readonly records: ReadonlyArray<Entry>
  readonly leaf: Node | undefined
  readonly invalid: number
  readonly agent: string
  readonly title: (messages: ReadonlyArray<SessionMessage.Info>) => string
  readonly directory: string
  readonly cost: number
  /** Child session IDs by the tool call that started them. */
  readonly links: ReadonlyMap<string, string>
  /** Child session IDs by Claude Code agent ID. */
  readonly agentLinks: ReadonlyMap<string, string>
}) {
  const tally: Tally = {
    attachments: 0,
    meta: 0,
    system: 0,
    synthetic: 0,
    signatures: 0,
    redacted: 0,
    truncated: 0,
    interrupted: 0,
    images: 0,
    blocks: new Set(),
  }
  const messages = convert({ ...input, path: branch(input.records, input.leaf), tally }).flatMap((encoded) => {
    const decoded = decodeMessage(encoded)
    if (Option.isSome(decoded)) return [decoded.value]
    tally.blocks.add(`unreadable ${encoded.type} message`)
    return []
  })
  const steps = messages.filter((message) => message.type === "assistant")
  const last = steps.at(-1)
  const timed = input.records.filter((record) => record.timestamp)
  const created = millis(timed[0]?.timestamp)
  const info = decodeInfo({
    id: input.id,
    ...(input.parentID ? { parentID: input.parentID } : {}),
    projectID: Project.ID.global,
    agent: input.agent,
    ...(last ? { model: { id: last.model.id, providerID: last.model.providerID } } : {}),
    cost: input.cost,
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
    time: { created, updated: Math.max(created, millis(timed.at(-1)?.timestamp)) },
    title: input.title(messages),
    location: { directory: input.directory },
  })
  return {
    info,
    messages,
    version: input.records.find((record) => record.version)?.version,
    warnings: warnings(input.records, input.invalid, tally),
  }
}

function warnings(records: ReadonlyArray<Entry>, invalid: number, tally: Tally) {
  const snapshots = records.filter((record) => record.type === "file-history-snapshot").length
  return [
    invalid && `Skipped ${count(invalid, "unreadable line")}`,
    tally.attachments &&
      `Dropped ${count(tally.attachments, "attachment record")} (hook output, reminders and injected context)`,
    tally.meta && `Dropped ${count(tally.meta, "hidden meta message")}`,
    tally.system && `Dropped ${count(tally.system, "system notice")} (API errors, hook summaries)`,
    tally.synthetic && `Dropped ${count(tally.synthetic, "locally generated assistant message")}`,
    tally.signatures &&
      `Dropped the thinking signatures of ${count(tally.signatures, "reasoning block")}; the reasoning text is kept`,
    tally.redacted && `Skipped ${count(tally.redacted, "redacted reasoning block")}`,
    tally.images && `Skipped ${count(tally.images, "image")} that ${tally.images === 1 ? "was" : "were"} not inline`,
    tally.truncated && `Truncated ${count(tally.truncated, "tool output")} above 64 KB`,
    tally.interrupted && `Marked ${count(tally.interrupted, "tool call")} without a result as interrupted`,
    tally.blocks.size > 0 && `Skipped unsupported content: ${[...tally.blocks].toSorted().join(", ")}`,
    snapshots > 0 &&
      `File history was not imported (${count(snapshots, "snapshot")}); edits made before the import cannot be reverted`,
    records.some((record) => record.type === "mode") && "Permission mode changes were not imported",
  ].filter((warning): warning is string => typeof warning === "string")
}

type Encoded = (typeof SessionMessage.Info)["Encoded"]
type ToolEncoded = Extract<(typeof SessionMessage.AssistantContent)["Encoded"], { type: "tool" }>
type ContentEncoded = (typeof SessionMessage.ToolStateCompleted)["Encoded"]["content"][number]

/** Convert the active branch into Redcode messages, merging the records Claude Code splits one response into. */
function convert(input: {
  readonly id: string
  readonly seed: string
  readonly records: ReadonlyArray<Entry>
  readonly path: ReadonlyArray<Entry>
  readonly agent: string
  readonly links: ReadonlyMap<string, string>
  readonly agentLinks: ReadonlyMap<string, string>
  readonly tally: Tally
}): ReadonlyArray<Encoded> {
  const tally = input.tally
  const onPath = new Set(input.path.flatMap((record) => (record.uuid ? [record.uuid] : [])))
  // Parallel tool calls branch the tree, so responses and results are gathered from every branch by ID.
  const responses = Map.groupBy(
    input.records.filter((record) => record.type === "assistant" && record.message?.id),
    (record) => record.message?.id ?? "",
  )
  const results = new Map<string, { readonly block: ToolResult; readonly record: Entry }>()
  input.records
    .filter((record) => record.type === "user" && Array.isArray(record.message?.content))
    .toSorted((a, b) => Number(onPath.has(b.uuid ?? "")) - Number(onPath.has(a.uuid ?? "")))
    .forEach((record) =>
      blocks(record, tally).forEach((block) => {
        if (block.type === "tool_result" && !results.has(block.tool_use_id))
          results.set(block.tool_use_id, { block, record })
      }),
    )
  const ids = ImportSource.messageIDs(input.seed)
  const emitted = new Set<string>()
  const pending: { boundary?: Entry } = {}
  return input.path.flatMap((record): ReadonlyArray<Encoded> => {
    const at = millis(record.timestamp)
    if (record.type === "assistant") {
      const responseID = record.message?.id ?? record.uuid ?? ""
      if (emitted.has(responseID)) return []
      emitted.add(responseID)
      if (record.message?.model === "<synthetic>") {
        tally.synthetic++
        return []
      }
      const parts = dedupe(responses.get(responseID) ?? [record])
      return [step({ ...input, id: ids(responseID, at), parts, results })]
    }
    if (record.type === "system") {
      if (record.subtype === "compact_boundary") pending.boundary = record
      else tally.system++
      return []
    }
    if (record.type === "attachment") {
      const prompt = queuedPrompt(record)
      if (prompt === undefined) {
        tally.attachments++
        return []
      }
      return [{ id: ids(record.uuid ?? "", at), type: "user", text: prompt, time: { created: at } }]
    }
    if (record.type !== "user") return []
    if (record.isCompactSummary) {
      const boundary = pending.boundary
      pending.boundary = undefined
      // Responses repeated after a compaction belong to the new context, so they are imported again.
      emitted.clear()
      return [
        {
          id: ids(record.uuid ?? "", at),
          type: "compaction",
          status: "completed",
          reason: boundary?.compactMetadata?.trigger === "manual" ? "manual" : "auto",
          summary: text(record, tally),
          recent: recent(input.path, boundary, tally),
          time: { created: at },
        },
      ]
    }
    if (record.isMeta) {
      tally.meta++
      return []
    }
    const prompt = text(record, tally)
    const files = images(record, tally)
    if (!prompt && files.length === 0) return []
    return [
      {
        id: ids(record.uuid ?? "", at),
        type: "user",
        text: prompt,
        ...(files.length > 0 ? { files } : {}),
        time: { created: at },
      },
    ]
  })
}

/** One assistant step from every record of one model response. */
function step(input: {
  readonly id: string
  readonly agent: string
  readonly parts: ReadonlyArray<Entry>
  readonly results: ReadonlyMap<string, { readonly block: ToolResult; readonly record: Entry }>
  readonly links: ReadonlyMap<string, string>
  readonly agentLinks: ReadonlyMap<string, string>
  readonly tally: Tally
}): Encoded {
  const tally = input.tally
  const first = input.parts[0]
  const final = input.parts.at(-1)
  const created = millis(first?.timestamp)
  const seen = new Set<string>()
  const content = input.parts.flatMap((part) =>
    blocks(part, tally).flatMap((block): ReadonlyArray<(typeof SessionMessage.AssistantContent)["Encoded"]> => {
      const key = block.type === "tool_use" ? `tool:${block.id}` : JSON.stringify(block)
      if (seen.has(key)) return []
      seen.add(key)
      if (block.type === "text") return block.text ? [{ type: "text", text: block.text }] : []
      if (block.type === "thinking") {
        if (block.signature) tally.signatures++
        return block.thinking ? [{ type: "reasoning", text: block.thinking }] : []
      }
      if (block.type === "redacted_thinking") {
        tally.redacted++
        return []
      }
      if (block.type === "tool_use") return [tool({ ...input, block, created: millis(part.timestamp) })]
      tally.blocks.add(`${block.type} in an assistant message`)
      return []
    }),
  )
  const usage = final?.message?.usage
  const finish = FINISH[final?.message?.stop_reason ?? ""]
  return {
    id: input.id,
    type: "assistant",
    agent: input.agent,
    model: { id: first?.message?.model ?? "unknown", providerID: "anthropic" },
    content,
    ...(finish ? { finish } : {}),
    ...(usage
      ? {
          tokens: {
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
            reasoning: 0,
            cache: { read: usage.cache_read_input_tokens ?? 0, write: usage.cache_creation_input_tokens ?? 0 },
          },
        }
      : {}),
    time: { created, completed: Math.max(created, millis(final?.timestamp)) },
  }
}

const FINISH: Record<string, "stop" | "length" | "tool-calls" | "content-filter"> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool-calls",
  refusal: "content-filter",
}

function tool(input: {
  readonly block: Extract<Block, { type: "tool_use" }>
  readonly created: number
  readonly results: ReadonlyMap<string, { readonly block: ToolResult; readonly record: Entry }>
  readonly links: ReadonlyMap<string, string>
  readonly agentLinks: ReadonlyMap<string, string>
  readonly tally: Tally
}): ToolEncoded {
  const base = { type: "tool" as const, id: input.block.id, name: input.block.name }
  const result = input.results.get(input.block.id)
  if (!result) {
    // A call left without a result was cut off, whether or not the session continued after it.
    input.tally.interrupted++
    return {
      ...base,
      state: {
        status: "error",
        input: input.block.input,
        error: { type: "aborted", message: ToolInterrupted.MESSAGE },
      },
      time: { created: input.created },
    }
  }
  const child =
    input.links.get(input.block.id) ??
    Option.getOrUndefined(
      Option.flatMap(decodeAgentResult(result.record.toolUseResult), (value) =>
        Option.fromNullishOr(input.agentLinks.get(value.agentId)),
      ),
    )
  const content = output(result.block, input.tally)
  const metadata = child ? { metadata: { sessionID: child } } : {}
  const time = { created: input.created, completed: Math.max(input.created, millis(result.record.timestamp)) }
  if (result.block.is_error)
    return {
      ...base,
      state: {
        status: "error",
        input: input.block.input,
        error: { type: "tool", message: errorMessage(content) },
        content,
        ...metadata,
      },
      time,
    }
  return { ...base, state: { status: "completed", input: input.block.input, content, ...metadata }, time }
}

/** A tool result's model-visible output, with secrets redacted and oversized text truncated. */
function output(block: ToolResult, tally: Tally): [ContentEncoded, ...Array<ContentEncoded>] {
  const items =
    typeof block.content === "string"
      ? [{ type: "text" as const, text: block.content }]
      : (block.content ?? []).flatMap((item): ReadonlyArray<ContentEncoded> => {
          const decoded = decodeBlock(item)
          if (Option.isNone(decoded)) {
            tally.blocks.add(`${Option.getOrUndefined(decodeBlockType(item))?.type ?? "unknown"} in a tool result`)
            return []
          }
          if (decoded.value.type === "text") return [{ type: "text", text: decoded.value.text }]
          if (decoded.value.type === "image") {
            const uri = dataURI(decoded.value, tally)
            return uri ? [{ type: "file", uri, mime: decoded.value.source.media_type ?? "image/png" }] : []
          }
          tally.blocks.add(`${decoded.value.type} in a tool result`)
          return []
        })
  const [head, ...rest] = items.map((item) =>
    item.type === "text" ? { ...item, text: limit(item.text, tally) } : item,
  )
  return head ? [head, ...rest] : [{ type: "text", text: "(no output)" }]
}

function limit(value: string, tally: Tally) {
  const redacted = Redact.redact(value)
  if (redacted.length <= OUTPUT_LIMIT) return redacted
  tally.truncated++
  return `${redacted.slice(0, OUTPUT_LIMIT)}\n\n[Output truncated by the ${NAME} import: ${redacted.length - OUTPUT_LIMIT} more characters]`
}

function errorMessage(content: ReadonlyArray<ContentEncoded>) {
  const message = content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join("\n")
    .trim()
  if (!message) return "Tool call failed"
  return message.length > 2_000 ? `${message.slice(0, 2_000)}…` : message
}

/** The preserved tail a compaction kept verbatim, when it lies before the boundary on the active branch. */
function recent(active: ReadonlyArray<Entry>, boundary: Entry | undefined, tally: Tally) {
  const segment = boundary?.compactMetadata?.preservedSegment
  if (!boundary || !segment) return ""
  const end = active.indexOf(boundary)
  const head = active.findIndex((record) => record.uuid === segment.headUuid)
  const tail = active.findIndex((record) => record.uuid === segment.tailUuid)
  // A segment relinked after the summary is imported as ordinary messages after the compaction instead.
  if (head < 0 || tail < head || tail >= end) return ""
  return active
    .slice(head, tail + 1)
    .flatMap((record) => {
      if (record.type === "user" && !record.isMeta) {
        const value = text(record, tally)
        return value ? [`[User]: ${value}`] : []
      }
      if (record.type !== "assistant") return []
      return blocks(record, tally).flatMap((block) => (block.type === "text" ? [`[Assistant]: ${block.text}`] : []))
    })
    .join("\n\n")
}

function blocks(record: Entry, tally: Tally): ReadonlyArray<Block> {
  const content = record.message?.content
  if (typeof content === "string") return [{ type: "text", text: content }]
  return (content ?? []).flatMap((item) => {
    const decoded = decodeBlock(item)
    if (Option.isSome(decoded)) return [decoded.value]
    tally.blocks.add(`${Option.getOrUndefined(decodeBlockType(item))?.type ?? "unknown"} block`)
    return []
  })
}

function text(record: Entry, tally: Tally) {
  return blocks(record, tally)
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n")
}

function images(record: Entry, tally: Tally) {
  return blocks(record, tally).flatMap((block) => {
    if (block.type !== "image") return []
    if (block.source.type !== "base64" || !block.source.data) {
      tally.images++
      return []
    }
    return [
      { data: block.source.data, mime: block.source.media_type ?? "image/png", source: { type: "inline" as const } },
    ]
  })
}

function dataURI(block: Extract<Block, { type: "image" }>, tally: Tally) {
  if (block.source.type === "base64" && block.source.data)
    return `data:${block.source.media_type ?? "image/png"};base64,${block.source.data}`
  tally.images++
  return undefined
}

/** A prompt the user typed while Claude Code was busy, which it delivers as an attachment. */
function queuedPrompt(record: Entry) {
  const attachment = record.attachment
  if (attachment?.type !== "queued_command" || attachment.isMeta) return undefined
  if (attachment.commandMode !== "prompt" || (attachment.origin?.kind ?? "human") !== "human") return undefined
  if (typeof attachment.prompt === "string") return attachment.prompt
  const parts = (attachment.prompt ?? []).flatMap((item) =>
    Option.match(decodeBlock(item), {
      onNone: () => [],
      onSome: (block) => (block.type === "text" ? [block.text] : []),
    }),
  )
  return parts.length > 0 ? parts.join("\n\n") : undefined
}

/** Records Claude Code rewrote appear more than once; keep the newest copy of each. */
function dedupe(records: ReadonlyArray<Entry>) {
  const newest = new Map(records.map((record, index) => [record.uuid ?? `#${index}`, record]))
  return records.filter((record, index) => newest.get(record.uuid ?? `#${index}`) === record)
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

/** Claude Code keeps its data in `CLAUDE_CONFIG_DIR`, which defaults to `~/.claude`. */
export function directories() {
  return [process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")]
}

// Session IDs are UUIDs; anything else must not reach a path.
const REF = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export function adapter(input: { readonly directories: ReadonlyArray<string> }): ImportSource.Adapter {
  const projects = () => input.directories.map((root) => path.join(root, "projects")).find((dir) => existsSync(dir))
  const store = Effect.fnUntraced(function* () {
    const dir = projects()
    if (!dir)
      return yield* new ImportSource.UnavailableError({
        source: "claude-code",
        message: "No Claude Code session store found",
      })
    return dir
  })
  return {
    source: "claude-code",
    name: NAME,
    detect: Effect.fnUntraced(function* () {
      const dir = projects()
      const base = { source: "claude-code" as const, name: NAME }
      if (!dir) return { ...base, available: false, sessions: 0, warning: "No Claude Code session store found" }
      return yield* transcripts(dir).pipe(
        Effect.match({
          onFailure: (error) => ({ ...base, path: dir, available: false, sessions: 0, warning: error.message }),
          onSuccess: (files) => ({ ...base, path: dir, available: true, sessions: files.length }),
        }),
      )
    }),
    list: Effect.fnUntraced(function* (options) {
      const dir = yield* store()
      const files = yield* transcripts(dir)
      // The project folder name is a lossy slug of the directory, so it only narrows the candidates.
      const slug = options.directory?.replace(/[^A-Za-z0-9]/g, "-").toLowerCase()
      const narrowed = slug ? files.filter((file) => file.project.toLowerCase() === slug) : files
      const candidates = narrowed.length > 0 ? narrowed : files
      const timed = yield* Effect.forEach(candidates, (file) =>
        attempt(() => stat(file.path)).pipe(Effect.map((info) => ({ ...file, size: info.size, mtime: info.mtimeMs }))),
      )
      // The modification time only decides which headers to read first, newest first, and only until enough
      // sessions in the directory are found. Files written within one timestamp tick tie, so the result is
      // ordered by the time each transcript records.
      const sorted = timed.toSorted((a, b) => b.mtime - a.mtime || a.ref.localeCompare(b.ref))
      const found: Array<SessionImport.Summary> = []
      for (const file of sorted) {
        if (found.length >= options.limit) break
        const item = yield* summary(file)
        if (item && (!options.directory || sameDirectory(item.directory, options.directory))) found.push(item)
      }
      return found.toSorted(
        (a, b) =>
          DateTime.toEpochMillis(b.time.updated) - DateTime.toEpochMillis(a.time.updated) || a.ref.localeCompare(b.ref),
      )
    }),
    load: Effect.fnUntraced(function* (ref) {
      const dir = yield* store()
      const file = REF.test(ref) ? (yield* transcripts(dir)).find((item) => item.ref === ref) : undefined
      if (!file) return yield* new ImportSource.NotFoundError({ source: "claude-code", ref })
      const main = parse(yield* attempt(() => Bun.file(file.path).text()))
      const agents = yield* subagents(path.join(path.dirname(file.path), ref, "subagents"))
      const normalized = normalize({ sessionId: ref, main, agents })
      if (normalized.sessions[0]?.ref !== ref)
        return yield* new ImportSource.UnavailableError({
          source: "claude-code",
          message: `${NAME} session ${ref} could not be read`,
        })
      return {
        source: "claude-code" as const,
        name: NAME,
        path: file.path,
        note: TOOL_NOTE,
        sessions: normalized.sessions,
      }
    }),
  }
}

/** Top-level session transcripts, one `<session>.jsonl` per session in each project folder. */
function transcripts(dir: string) {
  return Effect.gen(function* () {
    const projects = (yield* attempt(() => readdir(dir, { withFileTypes: true }))).filter((entry) =>
      entry.isDirectory(),
    )
    const nested = yield* Effect.forEach(projects, (project) =>
      attempt(() => readdir(path.join(dir, project.name), { withFileTypes: true })).pipe(
        Effect.map((entries) =>
          entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
            .map((entry) => ({
              ref: entry.name.slice(0, -".jsonl".length),
              project: project.name,
              path: path.join(dir, project.name, entry.name),
            })),
        ),
      ),
    )
    return nested.flat()
  })
}

function subagents(dir: string) {
  return Effect.gen(function* () {
    if (!existsSync(dir)) return []
    const names = (yield* attempt(() => readdir(dir))).filter(
      (name) => name.startsWith("agent-") && name.endsWith(".jsonl"),
    )
    return yield* Effect.forEach(names, (name) =>
      Effect.gen(function* () {
        const base = name.slice(0, -".jsonl".length)
        const metaFile = path.join(dir, `${base}.meta.json`)
        const meta = existsSync(metaFile)
          ? Option.getOrUndefined(decodeMeta(yield* attempt(() => Bun.file(metaFile).text())))
          : undefined
        const transcript = parse(yield* attempt(() => Bun.file(path.join(dir, name)).text()))
        return { id: base.slice("agent-".length), ...(meta ? { meta } : {}), transcript }
      }),
    )
  })
}

/**
 * Summarize a transcript from its first and last records and its size, without parsing the whole
 * file: long sessions reach tens of megabytes. Small files are counted exactly.
 */
function summary(file: { readonly ref: string; readonly path: string; readonly size: number; readonly mtime: number }) {
  return Effect.gen(function* () {
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
    const conversational = (record: Entry) => record.type === "user" || record.type === "assistant"
    if (!records.some(conversational)) return undefined
    const cwd = records.find((record) => record.cwd)?.cwd ?? ""
    const sampled = messageCount(first) + messageCount(last)
    const model = records.findLast(
      (record) => record.type === "assistant" && record.message?.model && record.message.model !== "<synthetic>",
    )?.message?.model
    const prompt = first.find(
      (record) => record.type === "user" && !record.isMeta && !record.isCompactSummary && promptText(record),
    )
    const title =
      records.findLast((record) => record.customTitle)?.customTitle ??
      records.findLast((record) => record.aiTitle)?.aiTitle ??
      (prompt ? truncate(promptText(prompt)) : `${NAME} session ${file.ref.slice(0, 8)}`)
    const created = Math.round(millis(first.find((record) => record.timestamp)?.timestamp) || file.mtime)
    // The newest recorded record time, which survives copies and restores that reset the file's mtime.
    const updated = Math.round(millis(records.findLast((record) => record.timestamp)?.timestamp) || file.mtime)
    const subagents = yield* attempt(() => readdir(path.join(path.dirname(file.path), file.ref, "subagents"))).pipe(
      Effect.map((names) => names.filter((name) => name.endsWith(".jsonl")).length),
      Effect.orElseSucceed(() => 0),
    )
    return yield* Schema.decodeUnknownEffect(SessionImport.Summary)({
      source: "claude-code",
      ref: file.ref,
      title,
      directory: ImportSource.directory(cwd),
      messages: whole ? sampled : Math.round((sampled * file.size) / (2 * SAMPLE)),
      subagents,
      ...(model ? { model: `anthropic/${model}` } : {}),
      time: { created, updated: Math.max(created, updated) },
    }).pipe(Effect.mapError(unreadable))
  })
}

/** User prompts plus distinct model responses, the way an import merges them. */
function messageCount(records: ReadonlyArray<Entry>) {
  const prompts = records.filter(
    (record) =>
      record.type === "user" && !record.isMeta && !record.isSidechain && !record.isCompactSummary && promptText(record),
  ).length
  const responses = new Set(
    records.flatMap((record) =>
      record.type === "assistant" && !record.isSidechain && record.message?.id ? [record.message.id] : [],
    ),
  )
  return prompts + responses.size
}

function promptText(record: Entry) {
  const content = record.message?.content
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

function attempt<A>(run: () => Promise<A>) {
  return Effect.tryPromise({ try: run, catch: unreadable })
}

function unreadable(cause: unknown) {
  return new ImportSource.UnavailableError({
    source: "claude-code",
    message: `Failed to read the ${NAME} session store: ${cause instanceof Error ? cause.message : String(cause)}`,
  })
}
