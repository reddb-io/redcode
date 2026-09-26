import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { CompactionEvaluation } from "@reddb-io/redcode-core/session/compaction-evaluation"
import { Database } from "@reddb-io/redcode-core/database/database"
import { Verbose } from "@reddb-io/redcode-core/observability/verbose"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { ConfigV1 } from "@reddb-io/redcode-core/v1/config/config"
import { Session } from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"
import { SessionProcessor } from "./processor"
import { SessionRetry } from "./retry"
import { LLM } from "./llm"
import { LLMEvent, isContextOverflowFailure } from "@reddb-io/redcode-llm"
import { AuxDeadline } from "./aux-deadline"
import { SessionGuardLog } from "./guard-log"
import { Agent } from "@/agent/agent"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"

import { DateTime, Duration, Effect, Fiber, Layer, Context, Scope, Stream } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow, usable } from "./overflow"
import { serviceUse } from "@reddb-io/redcode-core/effect/service-use"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import {
  SUMMARY_TEMPLATE,
  buildPrompt,
  elideMiddle,
  forkPreparation,
  summaryError,
  systemPrompt,
} from "@reddb-io/redcode-core/session/compaction"
import { CompactionPolicy } from "@reddb-io/redcode-core/session/compaction-policy"
import { CompactionAnchors } from "@reddb-io/redcode-core/session/compaction-anchors"
import { ProviderTransform } from "@/provider/transform"
import { ComboMember } from "@/provider/combo-member"
import { ToolSearch } from "./tool-search"
import type { ModelMessage, Tool as AITool } from "ai"
import { NamedError } from "@reddb-io/redcode-core/util/error"
import { Permission } from "@/permission"
import { TuiEvent } from "@/server/tui-event"
import fs from "fs"
import path from "path"
import { CompactionGuard } from "./compaction-guard"
import { createHash } from "crypto"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { SessionStatus } from "./status"
import { SessionInput } from "@reddb-io/redcode-core/session/input"
import { SessionCompactionEvent } from "@reddb-io/redcode-schema/session-compaction-event"
import { OperationHook } from "@reddb-io/redcode-core/operation-hook"
import { SessionContextEpoch } from "@reddb-io/redcode-core/session/context-epoch"
import { OperationHookBridge } from "@/operation-hook-bridge"

export const Event = SessionCompactionEvent

const TOOL_OUTPUT_MAX_CHARS = 2_000
const SESSION_HISTORY = "session_history"
const PRUNE_PROTECTED_TOOLS = ["skill"]
/** A fold window smaller than this cannot hold a useful piece of history next to the summary. */
const MIN_FOLD_WINDOW = 1_000
/** Share of the usable window the anchors block may take. */
const ANCHORS_SHARE = 0.05

/**
 * Providers whose prompt cache reuses any matching prefix, so a summary request that repeats the
 * conversation's system prompt, tools and messages pays for little more than its instruction. An
 * allowlist: an OpenAI-compatible backend does not cache prefixes just by speaking that protocol.
 */
export function prefixCacheable(model: Provider.Model) {
  const npm = model.api.npm
  return (
    npm === "@ai-sdk/openai" ||
    anthropicStyle(model) ||
    /deepseek/i.test(npm) ||
    (npm === "@ai-sdk/openai-compatible" && /deepseek/i.test(model.providerID))
  )
}

/**
 * Anthropic's API refuses tool_use and tool_result blocks unless tools are sent, and its SDK sends
 * no tools for a "none" tool choice, so these providers get the tools with the default choice.
 */
function anthropicStyle(model: Provider.Model) {
  return model.api.npm === "@ai-sdk/anthropic" || model.api.npm === "@ai-sdk/google-vertex/anthropic"
}

function cachedInstruction(input: { tail?: string }) {
  return [
    "The conversation above is about to be replaced by a summary. Do not continue the work: answer with the summary as text only, without calling any tool.",
    "If the conversation begins with a summary of earlier work, that summary is discarded after this, so carry forward everything in it that still applies; where later messages conflict with it, the later messages win.",
    input.tail
      ? `The messages from the one that begins "${input.tail}" onwards stay in context verbatim after this: summarize only what comes before them, and do not repeat them.`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
}

/** The person's own words in a user message. */
function userText(message: SessionV1.WithParts) {
  return message.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => part.text)
    .join("\n")
}

/** Files the history read and changed, relative to the worktree when inside it. */
function fileOperations(messages: readonly SessionV1.WithParts[], root: string) {
  // Written with "/" on every platform, so the anchors read the same on Windows.
  const relative = (file: string) => {
    const inside = path.relative(root, file)
    return inside && !inside.startsWith("..") && !path.isAbsolute(inside) ? inside.split(path.sep).join("/") : file
  }
  return messages.flatMap((message) =>
    message.parts.flatMap((part): CompactionAnchors.FileOperation[] => {
      if (part.type !== "tool" || part.state.status !== "completed") return []
      const input = part.state.input as Record<string, unknown>
      const file = typeof input.filePath === "string" ? relative(input.filePath) : undefined
      if (part.tool === "read" && file) return [{ path: file, kind: "read" }]
      if ((part.tool === "edit" || part.tool === "write") && file) return [{ path: file, kind: "modified" }]
      const changed = part.state.metadata?.files
      if (part.tool === "apply_patch" && Array.isArray(changed))
        return changed.flatMap((item: { filePath?: unknown; movePath?: unknown }) =>
          typeof (item.movePath ?? item.filePath) === "string"
            ? [{ path: relative(String(item.movePath ?? item.filePath)), kind: "modified" as const }]
            : [],
        )
      return []
    }),
  )
}

/** Branch and HEAD from the git directory, when it can be read without running git. */
function gitState(root: string) {
  try {
    let dir = path.join(root, ".git")
    if (fs.statSync(dir).isFile()) {
      const pointer = /gitdir:\s*(.+)/.exec(fs.readFileSync(dir, "utf8"))
      if (!pointer) return undefined
      dir = path.resolve(root, pointer[1]!.trim())
    }
    const head = fs.readFileSync(path.join(dir, "HEAD"), "utf8").trim()
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1]
    if (!ref) return { head: head.slice(0, 12) }
    const branch = ref.replace(/^refs\/heads\//, "")
    const common = fs.existsSync(path.join(dir, "commondir"))
      ? path.resolve(dir, fs.readFileSync(path.join(dir, "commondir"), "utf8").trim())
      : dir
    for (const base of [dir, common]) {
      const file = path.join(base, ref)
      if (fs.existsSync(file)) return { branch, head: fs.readFileSync(file, "utf8").trim().slice(0, 12) }
    }
    // After `git gc` a ref lives only in packed-refs: "<sha> <ref>" lines.
    for (const base of [dir, common]) {
      const packed = path.join(base, "packed-refs")
      if (!fs.existsSync(packed)) continue
      const sha = fs
        .readFileSync(packed, "utf8")
        .split("\n")
        .find((line) => line.endsWith(` ${ref}`))
        ?.split(" ")[0]
      if (sha) return { branch, head: sha.slice(0, 12) }
    }
    return { branch }
  } catch {
    return undefined
  }
}

/** The conversation's tools, advertised the same way but never run: a summary calls nothing. */
function inert(tools: Record<string, AITool>) {
  return Object.fromEntries(Object.entries(tools).map(([name, item]) => [name, { ...item, execute: undefined }]))
}

type Turn = {
  start: number
  end: number
  id: MessageID
}

type Tail = {
  start: number
  id: MessageID
}

type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

const serialize = (message: SessionV1.WithParts) => {
  if (message.info.role === "user") {
    const text = message.parts
      .filter((part): part is SessionV1.TextPart => part.type === "text" && !part.ignored)
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n")
    const files = message.parts.flatMap((part) =>
      part.type === "file" ? [`[Attached ${part.mime}: ${part.filename ?? "file"}]`] : [],
    )
    return [...(text ? [`[User]: ${text}`] : []), ...files].join("\n")
  }
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return part.text ? [`[Assistant]: ${part.text}`] : []
      if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
      if (part.type !== "tool") return []
      const call = `[Assistant tool call]: ${part.tool}(${JSON.stringify(part.state.input)})`
      if (part.state.status === "completed") {
        const attachments = (part.state.attachments ?? []).map(
          (item) => `[Attached ${item.mime}: ${item.filename ?? "file"}]`,
        )
        const output = part.state.time.compacted
          ? CompactionPolicy.trimPlaceholder({ tokens: Token.estimate(part.state.output), tool: part.tool })
          : truncate([part.state.output, ...attachments].join("\n"))
        return [call, `[Tool result]: ${output}`]
      }
      if (part.state.status === "error") return [call, `[Tool error]: ${part.state.error}`]
      return [call]
    })
    .join("\n")
}

function summaryText(message: SessionV1.WithParts) {
  const text = message.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

/**
 * A request the person made: a user message carrying their own text or attachment. Synthetic
 * messages (replays, continuations, reminders, goal turns) are the harness talking, not them.
 */
export function isRealRequest(message: SessionV1.WithParts) {
  return (
    message.info.role === "user" &&
    !message.parts.some((part) => part.type === "compaction") &&
    message.parts.some((part) => (part.type === "text" && !part.synthetic && !part.ignored) || part.type === "file")
  )
}

/** The turn a compaction serves: the latest user message that is not compaction's own. */
function turnOf(messages: SessionV1.WithParts[]) {
  return messages.findLast(
    (message) =>
      message.info.role === "user" &&
      !message.parts.some(
        (part) => part.type === "compaction" || (part.type === "text" && part.metadata?.compaction_continue === true),
      ),
  )?.info.id
}

/** A message we wrote ourselves by replaying the person's prompt after a compaction. */
function isReplay(parts: readonly SessionV1.Part[]) {
  const text = parts.filter((part) => part.type === "text")
  return text.length > 0 && text.every((part) => "synthetic" in part && part.synthetic === true)
}

function completedCompactions(messages: SessionV1.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    // The anchors are rebuilt from the history every time, never summarized again.
    const summary = summaryText(msg)
    return [{ userIndex, assistantIndex, summary: summary && (CompactionAnchors.strip(summary) || undefined) }]
  })
}

/** Tokens kept verbatim: a tenth of the usable window, clamped to [8k, 60k], unless configured. */
export function preserveRecentBudget(input: { cfg: ConfigV1.Info; model: Provider.Model }) {
  return CompactionPolicy.tailBudget({
    usable: usable(input),
    configured: input.cfg.compaction?.preserve_recent_tokens,
  })
}

function turns(messages: SessionV1.WithParts[]) {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (msg.parts.some((part) => part.type === "compaction")) continue
    result.push({
      start: i,
      end: messages.length,
      id: msg.info.id,
    })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

function splitTurn(input: {
  messages: SessionV1.WithParts[]
  turn: Turn
  model: Provider.Model
  budget: number
  estimate: (input: { messages: SessionV1.WithParts[]; model: Provider.Model }) => Effect.Effect<number>
}) {
  return Effect.gen(function* () {
    if (input.budget <= 0) return undefined
    if (input.turn.end - input.turn.start <= 1) return undefined
    for (let start = input.turn.start + 1; start < input.turn.end; start++) {
      const size = yield* input.estimate({
        messages: input.messages.slice(start, input.turn.end),
        model: input.model,
      })
      if (size > input.budget) continue
      return {
        start,
        id: input.messages[start]!.info.id,
      } satisfies Tail
    }
    return undefined
  })
}

export type ProcessInput = {
  parentID: MessageID
  messages: SessionV1.WithParts[]
  sessionID: SessionID
  auto: boolean
  overflow?: boolean
  /** Estimated tokens of what every request carries besides history: system prompt and tools. */
  overhead?: number
  /** Told, for an automatic compaction that committed, whether it freed enough room. */
  onMeasured?: (effective: boolean) => void
  /**
   * The conversation's last request exactly as it was sent: system prompt, tools, model messages,
   * and the ids of the history messages it was built from. With a provider that caches prefixes,
   * the summary request starts with it so the provider serves the conversation from its cache.
   */
  request?: { system: string[]; tools: Record<string, AITool>; messages: ModelMessage[]; seen: string[] }
}

export type Relief = "fits" | "compact" | "none"

/**
 * Whether the conversation was still working when it was compacted, so the model has to be told
 * to go on. A turn that ended with a final answer stays ended: reviving it cost a provider turn and
 * invited work nobody asked for.
 */
export function midWork(messages: SessionV1.WithParts[], parentID: MessageID, overflow?: boolean) {
  // The provider refused the request before the step could finish.
  if (overflow) return true
  const end = messages.findIndex((message) => message.info.id === parentID)
  const history = end === -1 ? messages : messages.slice(0, end)
  const isRequest = (message: SessionV1.WithParts) =>
    message.info.role === "user" && !message.parts.some((part) => part.type === "compaction")
  const isAnswer = (message: SessionV1.WithParts) => message.info.role === "assistant" && !message.info.summary
  const request = history.findLastIndex(isRequest)
  const answer = history.findLastIndex(isAnswer)
  if (request === -1 && answer === -1) return false
  // A request nobody has answered yet: the compaction ran before its first step.
  if (request > answer) return true
  const last = history[answer]!
  if (last.info.role !== "assistant") return false
  if (last.info.error) return false
  if (!last.info.finish || ["tool-calls", "unknown"].includes(last.info.finish)) return true
  // Some providers finish with "stop" on a message that still carries tool calls; the loop keeps
  // going for those, so the continuation has to as well.
  return last.parts.some(
    (part) =>
      part.type === "tool" &&
      !part.metadata?.providerExecuted &&
      !(part.state.status === "error" && part.state.metadata?.interrupted === true),
  )
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: SessionV1.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  /**
   * Called before an automatic compaction would start. Over the threshold, old tool output is
   * trimmed only when that alone brings the context under the band (`fits`); otherwise nothing is
   * trimmed and a compaction is still needed (`compact`), so the summary request keeps the cached
   * prefix intact. Near the band, it trims once the provider's cache has already expired.
   */
  readonly relieve: (input: {
    sessionID: SessionID
    model: Provider.Model
    tokens: SessionV1.Assistant["tokens"]
    /** When the last request finished, to tell whether the provider's cache is still warm. */
    at?: number
  }) => Effect.Effect<Relief>
  /** `paused` means the summary was committed and automatic compaction is now paused. */
  readonly process: (input: ProcessInput) => Effect.Effect<"continue" | "stop" | "paused">
  readonly prepare: (
    input: ProcessInput & { tokens: SessionV1.Assistant["tokens"]; model: Provider.Model },
  ) => Effect.Effect<void>
  readonly discard: (sessionID: SessionID) => Effect.Effect<void>
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    auto: boolean
    overflow?: boolean
    /** What the person asked the summary to focus on. */
    focus?: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/SessionCompaction") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const llm = yield* LLM.Service
    const database = yield* Database.Service
    const config = yield* Config.Service
    const guards = yield* SessionGuardLog.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service
    const events = yield* EventV2Bridge.Service
    const hooks = yield* OperationHookBridge.Service
    const flags = yield* RuntimeFlags.Service
    const outputs = yield* ToolOutputBridge.Service
    const status = yield* SessionStatus.Service
    const intelligence = yield* Intelligence.Service
    const evaluateBoundary = CompactionEvaluation.boundary(intelligence)

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: SessionV1.Assistant["tokens"]
      model: Provider.Model
    }) {
      return overflow({
        cfg: yield* config.get(),
        tokens: input.tokens,
        model: input.model,
        outputTokenMax: flags.outputTokenMax,
      })
    })

    // The full text of an elided request, saved once per distinct content.
    const saved = new Map<string, string>()
    const retainRequest = Effect.fnUntraced(function* (text: string) {
      const key = createHash("sha256").update(text).digest("hex")
      const known = saved.get(key)
      if (known) return known
      const path = yield* outputs.retain(text)
      if (path) saved.set(key, path)
      return path
    })

    // What the last answered request carried besides history, from the tokens the provider reported
    // for it: the fallback when the loop has not measured a step yet.
    const reportedOverhead = Effect.fnUntraced(function* (messages: SessionV1.WithParts[], model: Provider.Model) {
      const index = messages.findLastIndex(
        (message) => message.info.role === "assistant" && !message.info.summary && !!message.info.finish,
      )
      const info = messages[index]?.info
      if (!info || info.role !== "assistant") return 0
      const reported = info.tokens.input + info.tokens.cache.read + info.tokens.cache.write
      if (!reported) return 0
      return Math.max(0, reported - (yield* estimate({ messages: messages.slice(0, index), model })))
    })

    const estimate = Effect.fn("SessionCompaction.estimate")(function* (input: {
      messages: SessionV1.WithParts[]
      model: Provider.Model
    }) {
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model)
      return Token.estimate(JSON.stringify(msgs))
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: SessionV1.WithParts[]
      cfg: ConfigV1.Info
      model: Provider.Model
    }) {
      const limit = input.cfg.compaction?.tail_turns
      if (limit !== undefined && limit <= 0) return { head: input.messages, tail_start_id: undefined }
      const budget = preserveRecentBudget({ cfg: input.cfg, model: input.model })
      const all = turns(input.messages)
      if (!all.length) return { head: input.messages, tail_start_id: undefined }
      const recent = limit === undefined ? all : all.slice(-limit)

      let total = 0
      let keep: Tail | undefined
      for (let i = recent.length - 1; i >= 0; i--) {
        const turn = recent[i]!
        // estimate lazily so cost stays proportional to the retained tail, not the whole session
        const size = yield* estimate({
          messages: input.messages.slice(turn.start, turn.end),
          model: input.model,
        })
        if (total + size <= budget) {
          total += size
          keep = { start: turn.start, id: turn.id }
          continue
        }
        const remaining = budget - total
        const split = yield* splitTurn({
          messages: input.messages,
          turn,
          model: input.model,
          budget: remaining,
          estimate,
        })
        if (split) keep = split
        else if (!keep) {
          yield* Effect.logInfo("tail fallback", { budget, size, total })
        }
        break
      }

      // Everything fits the budget: still keep the last full turn verbatim and summarize the turns
      // before it, instead of summarizing it all. A single turn has nothing before it and is
      // summarized whole. Messages are the unit, and a tool call and its result live in one
      // assistant message, so no cut here separates them.
      if (keep?.start === 0) {
        const last = all.at(-1)!
        if (last.start > 0) keep = { start: last.start, id: last.id }
      }
      if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined }
      return {
        head: input.messages.slice(0, keep.start),
        tail_start_id: keep.id,
      }
    })

    const visible = (sessionID: SessionID) =>
      MessageV2.filterCompactedEffect(sessionID).pipe(Effect.provideService(Database.Service, database), Effect.orDie)

    /**
     * Replaces old tool output with a placeholder that says how much was trimmed and that the model
     * can read it again, oldest first. Output in the last two turns, or within the kept tail's
     * budget counted back from the end, is never trimmed; neither is a trim that would free less
     * than PRUNE_MINIMUM_SAVINGS, which is not worth rewriting the cached prefix for. With `need`,
     * trimming stops once that much is freed. Returns the estimated tokens freed.
     */
    const trim = Effect.fn("SessionCompaction.trim")(function* (input: {
      sessionID: SessionID
      model: Provider.Model
      messages: SessionV1.WithParts[]
      need?: number
      /** False to only measure what a trim would free. */
      commit?: boolean
    }) {
      const cfg = yield* config.get()
      if (cfg.compaction?.prune === false) return 0
      const budget = preserveRecentBudget({ cfg, model: input.model })
      const candidates: Array<{ part: SessionV1.ToolPart; tokens: number }> = []
      let turns = 0
      let kept = 0
      let exhausted = false
      loop: for (let index = input.messages.length - 1; index >= 0; index--) {
        const message = input.messages[index]!
        if (message.info.role === "user" && !message.parts.some((part) => part.type === "compaction")) turns++
        if (message.info.role === "assistant" && message.info.summary) break loop
        if (message.info.role !== "assistant" || turns < CompactionPolicy.PRUNE_PROTECTED_TURNS) continue
        for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = message.parts[partIndex]!
          if (part.type !== "tool" || part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool) || part.state.time.compacted) continue
          const tokens = Token.estimate(part.state.output)
          if (!exhausted && kept + tokens <= budget) {
            kept += tokens
            continue
          }
          exhausted = true
          candidates.push({ part, tokens })
        }
      }
      const available = candidates.reduce((total, item) => total + item.tokens, 0)
      if (available < CompactionPolicy.PRUNE_MINIMUM_SAVINGS) return 0
      const need = Math.max(CompactionPolicy.PRUNE_MINIMUM_SAVINGS, input.need ?? Infinity)
      const now = Date.now()
      let freed = 0
      let count = 0
      for (const { part, tokens } of candidates.reverse()) {
        if (freed >= need) break
        if (part.state.status !== "completed") continue
        freed += tokens - Token.estimate(CompactionPolicy.trimPlaceholder({ tokens, tool: part.tool }))
        count++
        if (input.commit === false) continue
        part.state.time.compacted = now
        yield* session.updatePart(part)
      }
      if (input.commit === false) return Math.max(0, freed)
      yield* Effect.logInfo("trimmed old tool output", { "session.id": input.sessionID, freed, count })
      // Trims are permanent; the placeholder points the model at session_history.
      yield* events
        .publish(TuiEvent.ToastShow, {
          message: `Trimmed ${freed.toLocaleString("en-US")} tokens of old tool output`,
          variant: "info",
          duration: 4_000,
        })
        .pipe(Effect.ignore)
      return Math.max(0, freed)
    })

    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const messages = yield* visible(input.sessionID).pipe(
        Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
      )
      const user = messages?.findLast((message) => message.info.role === "user")?.info
      if (!messages || user?.role !== "user") return
      const model = ComboMember.model(
        input.sessionID,
        yield* provider.getModel(user.model.providerID, user.model.modelID).pipe(Effect.orDie),
      )
      yield* trim({ sessionID: input.sessionID, model, messages })
    })

    const relieve = Effect.fn("SessionCompaction.relieve")(function* (input: {
      sessionID: SessionID
      model: Provider.Model
      tokens: SessionV1.Assistant["tokens"]
      at?: number
    }) {
      const cfg = yield* config.get()
      const room = usable({ cfg, model: input.model, outputTokenMax: flags.outputTokenMax })
      const over = overflow({ cfg, tokens: input.tokens, model: input.model, outputTokenMax: flags.outputTokenMax })
      const count =
        input.tokens.total ||
        input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
      const target = Math.floor(room * CompactionGuard.EFFECTIVE_RATIO)
      const messages = yield* visible(input.sessionID)
      if (!over && cfg.compaction?.auto !== false && room > 0 && count >= room * 0.5) {
        const requests = messages.filter(isRealRequest)
        const latest = requests.at(-1)
        const since = messages.slice(
          messages.findLastIndex((message) => message.info.role === "assistant" && message.info.summary) + 1,
        ).length
        if (
          latest &&
          since >= 4 &&
          (yield* evaluateBoundary({
            sessionID: input.sessionID,
            userID: latest.info.id,
            sources: messages.slice(-12).map(serialize),
          }))
        )
          return "compact" as const
      }
      // Over the threshold the cached prefix is lost to the summary anyway. Below it, trimming is
      // only worth it once the provider has already dropped the cache and the context is near full.
      const cold =
        !over &&
        cfg.compaction?.auto !== false &&
        room > 0 &&
        count >= target &&
        CompactionPolicy.cacheCold({ lastRequestAt: input.at, now: Date.now() })
      if (!over && !cold) return "none" as const
      // Measured against the provider's own count, not a character estimate.
      const need = count - target
      const freeable = yield* trim({ sessionID: input.sessionID, model: input.model, messages, need, commit: false })
      const fits = freeable > 0 && count - freeable <= target
      // Over the threshold a trim that is not enough would only break the cached prefix the summary
      // request is about to reuse, so it waits for the compaction instead.
      if (freeable === 0 || (over && !fits)) return over ? ("compact" as const) : ("none" as const)
      const freed = yield* trim({ sessionID: input.sessionID, model: input.model, messages, need })
      yield* Effect.logInfo("relieved context by trimming", {
        "session.id": input.sessionID,
        before: count,
        after: count - freed,
        fits,
        cold,
      })
      yield* Verbose.log("compaction.relieved", {
        sessionID: input.sessionID,
        why: "old tool output trimmed",
        before: count,
        after: count - freed,
        fits,
      })
      return fits ? ("fits" as const) : ("none" as const)
    })

    const build = Effect.fn("SessionCompaction.build")(function* (input: ProcessInput) {
      const parent = input.messages.findLast((m) => m.info.id === input.parentID)
      if (!parent || parent.info.role !== "user") {
        throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
      }
      const userMessage = parent.info
      const compactionPart = parent.parts.find((part): part is SessionV1.CompactionPart => part.type === "compaction")

      let messages = input.messages
      let replay:
        | {
            info: SessionV1.User
            parts: SessionV1.Part[]
          }
        | undefined
      if (input.overflow) {
        const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
        for (let i = idx - 1; i >= 0; i--) {
          const msg = input.messages[i]
          if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
            replay = { info: msg.info, parts: msg.parts }
            messages = input.messages.slice(0, i)
            break
          }
        }
        // A replay is itself a user message, so a second overflow finds it and replays it again,
        // and the transcript grows another copy of what the person actually typed every time.
        // One replay per overflow chain: if the last thing we would replay is already one,
        // the content is in the summary and repeating it cannot make it fit.
        if (replay && isReplay(replay.parts)) {
          replay = undefined
          messages = input.messages
        }
        const hasContent =
          replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
        if (!hasContent) {
          replay = undefined
          messages = input.messages
        }
      }

      const agent = yield* agents.get("compaction")
      const settings = yield* intelligence.read()
      yield* Intelligence.requireConfigured(settings)
      const transformation = settings.principal
      const model = transformation
        ? yield* provider.getModel(transformation.providerID, transformation.id).pipe(Effect.orDie)
        : agent.model
          ? yield* provider.getModel(agent.model.providerID, agent.model.modelID).pipe(Effect.orDie)
          : ComboMember.model(
              input.sessionID,
              yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID).pipe(Effect.orDie),
            )
      const cfg = yield* config.get()
      const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
      const prior = completedCompactions(history)
      const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
      const previousSummary = prior.at(-1)?.summary
      const retained = history.filter((_, index) => !hidden.has(index))
      const selected = yield* select({ messages: retained, cfg, model })
      // The latest real request may sit before an earlier checkpoint, outside `history`, so it is
      // read from the whole session — minus admitted prompts still pending, which the loop keeps
      // model-invisible and which must not reach the summary or the retained request either.
      const pending = new Set<string>(
        (yield* SessionInput.listPending(database.db, input.sessionID)).map((row) => row.id),
      )
      const session_ = (yield* session.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)).filter(
        (message) => !pending.has(message.info.id) && message.info.id <= input.messages.at(-1)!.info.id,
      )
      const latestRequest = session_.findLast(isRealRequest)
      // Membership in the retained tail, not an id comparison: a promoted prompt keeps its
      // admission-time id but sits later in history, and would otherwise be summarised twice.
      const tailStart = selected.tail_start_id
        ? retained.findIndex((message) => message.info.id === selected.tail_start_id)
        : -1
      const inTail =
        latestRequest !== undefined &&
        tailStart >= 0 &&
        retained.slice(tailStart).some((message) => message.info.id === latestRequest.info.id)
      // A pasted request larger than the tail budget cannot ride every later request whole, or the
      // checkpoint leaves the context as full as it found it. A bounded head and tail stay verbatim;
      // the full text is saved, where the model can read it again, only once the checkpoint commits.
      const preserved =
        replay || !latestRequest || inTail
          ? undefined
          : { text: serialize(latestRequest), budget: preserveRecentBudget({ cfg, model }) }
      // Allow plugins to inject context or replace compaction prompt.
      const compacting = yield* plugin.trigger(
        "experimental.session.compacting",
        { sessionID: input.sessionID },
        { context: [], prompt: undefined },
      )
      const compactingFinal = yield* hooks.waterfall(OperationHook.Operation.Compaction.PreCompact, {
        timestamp: yield* DateTime.now,
        sessionID: input.sessionID,
        context: compacting.context,
        prompt: compacting.prompt,
      })
      // Mutate the V1 trigger result with the V2-decided context/prompt so the
      // downstream code keeps working with a single source of truth.
      ;(compacting as { context: unknown[] }).context = compactingFinal.context
      ;(compacting as { prompt: string | undefined }).prompt = compactingFinal.prompt
      const msgs = structuredClone(selected.head)
      yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
      const pieces = msgs.map(serialize).filter(Boolean)
      const conversation = pieces.join("\n\n")
      const focus = compactionPart?.focus
      const focusText = focus
        ? `Focus: ${focus}\nGive what this focus names the most detail in the summary; keep the rest brief.`
        : undefined
      const nextPrompt = [
        compacting.prompt ??
          [
            buildPrompt({
              previousSummary,
              context: [conversation],
            }),
            ...compacting.context,
          ]
            .filter(Boolean)
            .join("\n\n"),
        focusText,
      ]
        .filter(Boolean)
        .join("\n\n")
      const summaryOutput = CompactionPolicy.summaryMaxTokens(
        ProviderTransform.maxOutputTokens(model, flags.outputTokenMax),
        (yield* config.get()).compaction?.summary_max_tokens,
      )
      const inputLimit = model.limit.input || model.limit.context

      // With a prefix-caching provider the summary request repeats the conversation's own system
      // prompt, tools and messages, and asks for the summary in a final user message: the provider
      // then serves the conversation from its cache instead of reading a rewritten copy of it.
      const conversationModel = agent.model
        ? ComboMember.model(
            input.sessionID,
            yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID).pipe(Effect.orDie),
          )
        : model
      const conversationAgent = yield* agents.get(userMessage.agent)
      const cached = yield* Effect.gen(function* () {
        const request = input.request
        if (!request || !conversationAgent || input.overflow || compacting.prompt || !prefixCacheable(model))
          return undefined
        if (conversationModel.id !== model.id || conversationModel.providerID !== model.providerID) return undefined
        // The last request exactly as it was sent, then what history gained since, rendered and
        // transformed the way the loop renders a step.
        const seen = new Set(request.seen)
        const later = structuredClone(history.filter((message) => !seen.has(message.info.id)))
        if (later.length > 0) yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: later })
        const laterMessages = later.length > 0 ? yield* MessageV2.toModelMessagesEffect(later, model) : []
        const tailMessage = selected.tail_start_id
          ? retained.find((message) => message.info.id === selected.tail_start_id)
          : undefined
        const instruction = [
          systemPrompt,
          cachedInstruction({
            tail: tailMessage ? Array.from(serialize(tailMessage)).slice(0, 120).join("") : undefined,
          }),
          ...compacting.context,
          focusText,
          SUMMARY_TEMPLATE,
        ]
          .filter(Boolean)
          .join("\n\n")
        // Sized from what the provider counted for the last request, not from characters.
        const last = history.findLast(
          (message) => message.info.role === "assistant" && !message.info.summary && !!message.info.finish,
        )?.info
        const tokens = last?.role === "assistant" ? last.tokens : undefined
        const reported = tokens
          ? tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
          : 0
        const size =
          (reported ||
            Token.estimate(request.system.join("\n")) +
              Token.estimate(JSON.stringify(request.messages)) +
              Token.estimate(
                JSON.stringify(
                  Object.entries(request.tools).map(([name, item]) => [
                    name,
                    item.description,
                    (item.inputSchema as { jsonSchema?: unknown } | undefined)?.jsonSchema,
                  ]),
                ),
              )) +
          Token.estimate(JSON.stringify(laterMessages)) +
          Token.estimate(instruction)
        if (inputLimit > 0 && size + summaryOutput > inputLimit) return undefined
        return {
          user: userMessage,
          agent: conversationAgent,
          sessionID: input.sessionID,
          system: request.system,
          tools: inert(request.tools),
          // The tools stay in the prefix either way; a stray tool call fails the attempt.
          toolChoice: anthropicStyle(model) ? undefined : "none",
          model,
          maxOutputTokens: summaryOutput,
          messages: [
            ...request.messages,
            ...laterMessages,
            { role: "user", content: [{ type: "text", text: instruction }] },
          ],
        } satisfies LLM.StreamInput
      })
      // History larger than the summarizer can read at once is folded in windows. Worked out even
      // with a cached request, which falls back to it when the provider refuses.
      const fold =
        !compacting.prompt &&
        inputLimit > 0 &&
        Token.estimate(systemPrompt) + Token.estimate(nextPrompt) + summaryOutput > inputLimit
      // Kept verbatim, so the anchors do not quote them a second time.
      const kept = new Set<string>([
        ...(tailStart >= 0 ? retained.slice(tailStart).map((message) => message.info.id) : []),
        ...(preserved && latestRequest ? [latestRequest.info.id] : []),
      ])
      const sessionInfo = yield* session.get(input.sessionID).pipe(Effect.orDie)
      const historyTool =
        conversationAgent !== undefined &&
        !Permission.disabled(
          [SESSION_HISTORY],
          Permission.merge(conversationAgent.permission, sessionInfo.permission ?? []),
        ).has(SESSION_HISTORY)
      return {
        userMessage,
        compactionPart,
        replay,
        agent,
        model,
        selected,
        preserved,
        latestRequestID: latestRequest?.info.id,
        // From the whole session: after a checkpoint the turn's opening message is often hidden.
        turnID: turnOf(session_),
        previousSummary,
        conversation,
        // What the summary must be smaller than.
        source: [previousSummary, conversation].filter(Boolean).join("\n\n"),
        // The cached request reads the whole history.
        cachedSource: history.map(serialize).filter(Boolean).join("\n\n"),
        cached,
        fold,
        pieces,
        focusText,
        summaryOutput,
        // Every message up to now that is not kept verbatim, for the anchors.
        summarized: session_.filter((message) => !kept.has(message.info.id)),
        historyTool,
        stream: {
          user: userMessage,
          agent,
          sessionID: input.sessionID,
          tools: {},
          system: [systemPrompt],
          model,
          maxOutputTokens: summaryOutput,
          // The summary must see the history whole, never a router's trimmed copy of it.
          router: { tokenSaver: false },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: [
                    nextPrompt,
                    ...(compacting.prompt ? ["The following is the conversation history:", conversation] : []),
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                },
              ],
            },
          ],
        } satisfies LLM.StreamInput,
      }
    })

    type Prepared = Effect.Success<ReturnType<typeof build>>
    type Candidate = { prepared: Prepared; events: LLMEvent[] }
    const pending = new Map<
      SessionID,
      {
        prefix: string[]
        model: string
        config: string
        agent: string
        fiber: Fiber.Fiber<Candidate | undefined>
      }
    >()
    const discard = Effect.fn("SessionCompaction.discard")(function* (sessionID: SessionID) {
      const candidate = pending.get(sessionID)
      pending.delete(sessionID)
      if (candidate) yield* Fiber.interrupt(candidate.fiber)
    })
    const prepare = Effect.fn("SessionCompaction.prepare")(function* (
      input: ProcessInput & {
        tokens: SessionV1.Assistant["tokens"]
        model: Provider.Model
      },
    ) {
      const cfg = yield* config.get()
      const previous = pending.get(input.sessionID)
      if (
        previous &&
        (previous.config !== JSON.stringify(cfg) ||
          previous.model !== JSON.stringify(input.model) ||
          !previous.prefix.every((message, index) => message === JSON.stringify(input.messages[index])))
      )
        yield* discard(input.sessionID)
      if (
        cfg.compaction?.auto === false ||
        cfg.compaction?.background === false ||
        !input.model.limit.context ||
        input.overflow
      )
        return
      const threshold = usable({ cfg, model: input.model, outputTokenMax: flags.outputTokenMax })
      const count =
        input.tokens.total ||
        input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
      if (count < threshold - Math.min(8_000, Math.floor(threshold * 0.1)) || count >= threshold) return
      if (pending.has(input.sessionID)) return
      const prefix = input.messages.map((message) => JSON.stringify(message))
      const task = Effect.gen(function* () {
        const prepared = yield* build(input)
        // A history that needs folding is summarized when the compaction actually runs.
        if (prepared.fold) return
        const events = yield* llm.stream(prepared.stream).pipe(
          Stream.runCollect,
          Effect.map((events) => Array.from(events)),
        )
        const text = events
          .filter(LLMEvent.is.textDelta)
          .map((event) => event.text)
          .join("")
        if (
          events.some(
            (event) => LLMEvent.is.providerError(event) || (LLMEvent.is.stepFinish(event) && event.reason !== "stop"),
          )
        )
          return
        if (
          summaryError({
            summary: text,
            source: prepared.source,
            finish: events.findLast(LLMEvent.is.finish)?.reason,
          })
        )
          return
        return { prepared, events }
      })
      const fiber = yield* forkPreparation(
        task,
        scope,
        AuxDeadline.deadlineMs("compaction", cfg.experimental?.aux_timeout) ?? false,
      )
      pending.set(input.sessionID, {
        prefix,
        model: JSON.stringify(input.model),
        config: JSON.stringify(cfg),
        agent: input.messages.findLast((message) => message.info.role === "user")?.info.agent ?? "",
        fiber,
      })
    })

    /**
     * Summarizes a history too large for one summarizer request: each window of history folds into
     * the running summary. A window the provider rejects as too large is halved and tried again.
     * Returns the last window's request and events, which the processor replays into the summary
     * message, or nothing when the history cannot be folded.
     */
    /**
     * One summary request, collected whole. Anything but a text answer that finished normally is
     * a failed attempt: a provider error (flagged when it is a context overflow), a tool call, or
     * a cut-off answer. An interruption is not caught, so a person's abort still stops it.
     */
    const collect = Effect.fnUntraced(function* (stream: LLM.StreamInput, model: Provider.Model) {
      const outcome = yield* Effect.suspend(() =>
        llm.stream(stream).pipe(
          Stream.runCollect,
          Effect.flatMap((events) => {
            const error = events.find(LLMEvent.is.providerError)
            return error ? Effect.fail(error) : Effect.succeed(Array.from(events))
          }),
        ),
      ).pipe(
        Effect.retry(
          SessionRetry.policy({
            provider: model.providerID,
            parse: (error) => MessageV2.fromError(error, { providerID: model.providerID, modelID: model.id }),
            set: (info) => status.set(SessionID.make(stream.sessionID), { type: "retry", ...info }),
          }),
        ),
        Effect.map((events) => ({ events, error: undefined as unknown })),
        Effect.catch((error: unknown) => Effect.succeed({ events: [] as LLMEvent[], error })),
      )
      const rejected = outcome.error ?? outcome.events.find(LLMEvent.is.providerError)
      if (rejected !== undefined) {
        const error = MessageV2.fromError(rejected, { providerID: model.providerID, modelID: model.id })
        const overflowed = isContextOverflowFailure(rejected) || SessionV1.ContextOverflowError.isInstance(error)
        return { ok: false as const, overflow: overflowed, error, reason: overflowed ? "context overflow" : "error" }
      }
      const text = outcome.events
        .filter(LLMEvent.is.textDelta)
        .map((event) => event.text)
        .join("")
      const finish = outcome.events.findLast(LLMEvent.is.finish)?.reason
      if (outcome.events.some(LLMEvent.is.toolCall))
        return { ok: false as const, overflow: false, error: undefined, reason: "tool call" }
      // A `length` finish cut the summary off at the output budget, most of which reasoning models
      // spend thinking: the text so far is still a usable summary, and rejecting it fails the whole
      // compaction. Anything else but a complete answer stays a failed attempt.
      if ((finish !== "stop" && finish !== "length") || !text.trim())
        return { ok: false as const, overflow: false, error: undefined, reason: `finish ${finish ?? "missing"}` }
      return { ok: true as const, events: outcome.events }
    })

    const tooLarge = () =>
      new SessionV1.ContextOverflowError({
        message: "Conversation history too large to compact - exceeds model context limit",
      }).toObject()

    const foldHistory = Effect.fnUntraced(function* (prepared: Prepared, sessionID: SessionID) {
      const limit = prepared.model.limit.input || prepared.model.limit.context
      const fixed =
        Token.estimate(systemPrompt) +
        Token.estimate(buildPrompt({ previousSummary: " ", context: [] })) +
        Token.estimate(prepared.focusText ?? "") +
        prepared.summaryOutput
      // A margin for the estimate: it counts characters, the provider counts tokens.
      let window = Math.floor((limit - fixed) * 0.9)
      let running = prepared.previousSummary
      let remaining = prepared.pieces
      let last: { stream: LLM.StreamInput; events: LLMEvent[] } | undefined
      while (remaining.length > 0) {
        const budget = window - Token.estimate(running ?? "")
        if (budget < MIN_FOLD_WINDOW) return { error: tooLarge() }
        const chunk: string[] = []
        let used = 0
        for (const piece of remaining) {
          const size = Token.estimate(piece)
          if (chunk.length > 0 && used + size > budget) break
          chunk.push(size > budget ? elideMiddle(piece, budget) : piece)
          used += Math.min(size, budget)
        }
        const stream: LLM.StreamInput = {
          ...prepared.stream,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: [buildPrompt({ previousSummary: running, context: [chunk.join("\n\n")] }), prepared.focusText]
                    .filter(Boolean)
                    .join("\n\n"),
                },
              ],
            },
          ],
        }
        const outcome = yield* collect(stream, prepared.model)
        if (!outcome.ok) {
          if (outcome.overflow) {
            window = Math.floor(window / 2)
            yield* Effect.logInfo("compaction window rejected; halving", { "session.id": sessionID, window })
            continue
          }
          // A rate limit, a server error or a dropped connection is reported as itself.
          return {
            error:
              outcome.error ??
              new NamedError.Unknown({
                message: `Compaction summary did not finish successfully (${outcome.reason}). Original history was preserved.`,
              }).toObject(),
          }
        }
        running = outcome.events
          .filter(LLMEvent.is.textDelta)
          .map((event) => event.text)
          .join("")
        remaining = remaining.slice(chunk.length)
        last = { stream, events: outcome.events }
      }
      return last ?? { error: tooLarge() }
    })

    // The session reads as compacting for exactly as long as this runs, failures included: the TUI
    // shows "Compacting the conversation" from it instead of a spinner with nothing to say.
    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: ProcessInput) {
      yield* session.setCompacting({ sessionID: input.sessionID, time: Date.now() })
      yield* status.set(input.sessionID, { type: "busy", phase: "compacting", since: Date.now() })
      return yield* runCompaction(input).pipe(
        Effect.catchTag("IntelligenceError", (error) =>
          Effect.logWarning(error.message).pipe(Effect.as("stop" as const)),
        ),
        Effect.ensuring(session.setCompacting({ sessionID: input.sessionID }).pipe(Effect.ignore)),
      )
    })

    const runCompaction = Effect.fnUntraced(function* (input: ProcessInput) {
      const cached = pending.get(input.sessionID)
      const parent = input.messages.find((message) => message.info.id === input.parentID)
      const candidate =
        cached &&
        input.auto &&
        !input.overflow &&
        parent?.info.role === "user" &&
        cached.agent === parent.info.agent &&
        cached.config === JSON.stringify(yield* config.get()) &&
        cached.model ===
          JSON.stringify(
            ComboMember.model(
              input.sessionID,
              yield* provider.getModel(parent.info.model.providerID, parent.info.model.modelID).pipe(Effect.orDie),
            ),
          ) &&
        cached.prefix.every((message, index) => message === JSON.stringify(input.messages[index]))
          ? yield* Fiber.join(cached.fiber)
          : undefined
      yield* discard(input.sessionID)
      const prepared =
        candidate && parent?.info.role === "user" && cached
          ? {
              ...candidate.prepared,
              userMessage: parent.info,
              compactionPart: parent.parts.find((part): part is SessionV1.CompactionPart => part.type === "compaction"),
              selected: {
                ...candidate.prepared.selected,
                tail_start_id:
                  candidate.prepared.selected.tail_start_id ??
                  input.messages.slice(cached.prefix.length).find((message) => message.info.id !== input.parentID)?.info
                    .id,
              },
            }
          : yield* build(input)
      const ctx = yield* InstanceState.context
      // The replacement of the Context Epoch is requested before the summary exists. A crash
      // between here and the commit below leaves a pending compaction that runs again; the other
      // order could leave a summary the model reads under a baseline, and system updates, from
      // before it. The next step renders the fresh baseline, or keeps the current one while a
      // previously admitted source is unavailable, rather than starting an epoch from a partial
      // context or ending the turn.
      yield* SessionContextEpoch.requestReplacement(database.db, input.sessionID)
      const msg: SessionV1.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.parentID,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        variant: prepared.userMessage.model.variant,
        summary: true,
        path: {
          cwd: ctx.directory,
          root: ctx.worktree,
        },
        cost: 0,
        tokens: {
          output: 0,
          input: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: prepared.model.id,
        providerID: prepared.model.providerID,
        time: {
          created: Date.now(),
        },
      }
      yield* session.updateMessage(msg)
      // The turn's watchdog reads the step handle, and nothing here is it, so a provider that stops
      // answering would hold the turn open with nothing to show. Every provider call of a
      // compaction runs under this deadline, and a compaction that did not happen is reported as
      // itself rather than as silence.
      const compactionMs = AuxDeadline.deadlineMs("compaction", (yield* config.get()).experimental?.aux_timeout)
      const giveUp = Effect.fnUntraced(function* (message: SessionV1.Assistant, ms: number) {
        yield* guards.record({
          sessionID: input.sessionID,
          guard: "aux",
          action: "stop",
          subject: "compaction",
          detail: AuxDeadline.message("compaction", ms),
        })
        yield* Effect.logWarning(AuxDeadline.message("compaction", ms), { "session.id": input.sessionID })
        message.error = new SessionV1.ContextOverflowError({
          message: AuxDeadline.message("compaction", ms),
        }).toObject()
        message.finish = "error"
        yield* session.updateMessage(message)
        return "stop" as const
      })
      const deadline = <A, B = A>(effect: Effect.Effect<A>, onTimeout: Effect.Effect<B>) =>
        compactionMs === undefined
          ? effect
          : effect.pipe(Effect.timeoutOrElse({ duration: Duration.millis(compactionMs), orElse: () => onTimeout }))

      // The request whose answer becomes the summary: a background candidate, the cached request,
      // the folded history, or else the rewritten history streamed live below.
      type Attempt =
        | { stream: LLM.StreamInput; events?: readonly LLMEvent[]; source: string }
        | { error: NonNullable<SessionV1.Assistant["error"]> }
      const attempt = deadline<Attempt | "timeout">(
        Effect.gen(function* () {
          if (candidate) return { stream: prepared.stream, events: candidate.events, source: prepared.source }
          if (prepared.cached) {
            const outcome = yield* collect(prepared.cached, prepared.model)
            if (outcome.ok) return { stream: prepared.cached, events: outcome.events, source: prepared.cachedSource }
            // Any refusal of the cached request, an overflow included, falls back to the history
            // rewritten for the summarizer.
            yield* Effect.logWarning("cached summary request failed; summarizing the rewritten history", {
              "session.id": input.sessionID,
              reason: outcome.reason,
            })
          }
          if (!prepared.fold) return { stream: prepared.stream, source: prepared.source }
          const folded = yield* foldHistory(prepared, input.sessionID)
          return "error" in folded ? folded : { ...folded, source: prepared.source }
        }),
        Effect.succeed("timeout" as const),
      )
      const settled = yield* attempt
      if (settled === "timeout") return yield* giveUp(msg, compactionMs!)
      if ("error" in settled) {
        msg.error = settled.error
        msg.finish = "error"
        yield* session.updateMessage(msg)
        return "stop"
      }
      // Buffer and verify the checkpoint before the processor makes it eligible to replace history.
      const checked = yield* deadline(
        Effect.gen(function* () {
          yield* Intelligence.requireConfigured(yield* intelligence.read())
          const generated = settled.events
            ? { ok: true as const, events: settled.events }
            : yield* collect(settled.stream, prepared.model)
          if (!generated.ok) return { error: generated.error ?? tooLarge() }
          const inspect = (events: readonly LLMEvent[], attempt: number) =>
            Effect.gen(function* () {
              const text = events
                .filter(LLMEvent.is.textDelta)
                .map((event) => event.text)
                .join("")
              const finish = events.findLast(LLMEvent.is.finish)?.reason
              const structural =
                summaryError({ summary: text, source: settled.source, finish }) ??
                (finish === "length" ? CompactionEvaluation.partialError(text) : undefined)
              if (structural) return { issue: structural, unavailable: false }
              // Single reasoning keeps the structural and reduction checks and skips S1 by choice.
              if (Intelligence.mode(yield* intelligence.read()) === "single")
                return { issue: undefined, unavailable: false }
              const evaluation = yield* intelligence.evaluate({
                sessionID: input.sessionID,
                operation: "compaction",
                attempt,
                sources: [prepared.source],
                candidate: text,
                questions: CompactionEvaluation.questions,
              })
              yield* Intelligence.requireConfigured(yield* intelligence.read())
              return {
                issue:
                  evaluation?.decision === "accepted"
                    ? undefined
                    : `Checkpoint evaluation ${evaluation?.decision ?? "unavailable"}: ${evaluation?.issues.join(", ") ?? "No evaluation"}`,
                unavailable: !evaluation || evaluation.decision === "unavailable",
              }
            })
          const first = yield* inspect(generated.events, 0)
          if (!first.issue) return { ...settled, events: generated.events }
          if (first.unavailable)
            return {
              error: new SessionV1.ContextOverflowError({
                message: `${first.issue}. Original history preserved.`,
              }).toObject(),
            }
          const settings = yield* intelligence.read()
          yield* Intelligence.requireConfigured(settings)
          const principal = settings.principal
            ? yield* provider.getModel(settings.principal.providerID, settings.principal.id).pipe(Effect.orDie)
            : prepared.model
          const repairStream = {
            ...prepared.stream,
            model: principal,
            system: [
              ...prepared.stream.system,
              `Correct the checkpoint against the original history. Validation: ${first.issue}. Include every required section; do not invent evidence.`,
            ],
          }
          const repaired = yield* collect(repairStream, principal)
          if (!repaired.ok) return { error: repaired.error ?? tooLarge() }
          const second = yield* inspect(repaired.events, 1)
          return second.issue
            ? {
                error: new SessionV1.ContextOverflowError({
                  message: `${second.issue}. Original history preserved.`,
                }).toObject(),
              }
            : { ...settled, stream: repairStream, events: repaired.events }
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              error: new SessionV1.ContextOverflowError({
                message: `${String(error)}. Original history preserved.`,
              }).toObject(),
            }),
          ),
        ),
        Effect.succeed("timeout" as const),
      )
      if (checked === "timeout") return yield* giveUp(msg, compactionMs!)
      if ("error" in checked) {
        msg.error = checked.error
        msg.finish = "error"
        yield* session.updateMessage(msg)
        return "stop"
      }
      msg.modelID = checked.stream.model.id
      msg.providerID = checked.stream.model.providerID
      yield* session.updateMessage(msg)
      const processor = yield* processors.create({
        assistantMessage: msg,
        sessionID: input.sessionID,
        model: checked.stream.model,
        compacting: true,
      })
      const result = yield* deadline(
        processor.process({ ...checked.stream, user: prepared.userMessage }, checked.events),
        Effect.suspend(() => giveUp(processor.message, compactionMs!)),
      )

      // Compaction requests have no tools to resume after, so a reconnect continuation cannot
      // produce a valid checkpoint. Keep the original history and let a later compaction retry.
      if (result === "reconnect") return "stop"
      // Compaction never listens for a model switch; a switch cannot end its retry wait.
      if (result === "switch") return "stop"

      if (result === "compact") {
        processor.message.error = new SessionV1.ContextOverflowError({
          message: prepared.replay
            ? "Conversation history too large to compact - exceeds model context limit"
            : "Session too large to compact - context exceeds model limit even after stripping media",
        }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        return "stop"
      }

      if (processor.message.error) return "stop"
      const checkpoint = yield* MessageV2.get({ sessionID: input.sessionID, messageID: msg.id }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      // Compared against the summarised source only: the preserved latest request is carried
      // alongside the summary, not produced by it, and counting it rejected every checkpoint of a
      // history made mostly of one large request.
      const error = summaryError({
        summary: summaryText(checkpoint) ?? "",
        source: settled.source,
        finish: processor.message.finish,
      })
      if (error) {
        processor.message.error = new SessionV1.ContextOverflowError({ message: error }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        return "stop"
      }
      if (prepared.preserved) {
        const { text, budget } = prepared.preserved
        const bounded = Token.estimate(text) <= budget ? text : elideMiddle(text, budget, yield* retainRequest(text))
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: input.sessionID,
          type: "text",
          synthetic: true,
          text: `\n\n<latest-user-request>\n${bounded}\n</latest-user-request>`,
        })
      }

      // Facts built by code, not by the model, so they survive every compaction verbatim.
      const anchors = CompactionAnchors.build({
        userMessages: prepared.summarized.filter(isRealRequest).map(userText),
        files: fileOperations(prepared.summarized, ctx.directory),
        git: gitState(ctx.worktree),
        historyTool: prepared.historyTool,
        maxTokens: Math.min(
          CompactionAnchors.MAX_TOKENS,
          Math.floor(
            usable({ cfg: yield* config.get(), model: prepared.model, outputTokenMax: flags.outputTokenMax }) *
              ANCHORS_SHARE,
          ),
        ),
      })
      if (anchors)
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: input.sessionID,
          type: "text",
          synthetic: true,
          text: `\n\n${anchors}`,
        })

      if (
        prepared.compactionPart &&
        prepared.selected.tail_start_id &&
        prepared.compactionPart.tail_start_id !== prepared.selected.tail_start_id
      ) {
        yield* session.updatePart({
          ...prepared.compactionPart,
          tail_start_id: prepared.selected.tail_start_id,
        })
      }
      // The summary becomes a history boundary only after validation and tail persistence.
      const configured = yield* intelligence.read().pipe(Effect.flatMap(Intelligence.requireConfigured), Effect.result)
      if (configured._tag === "Failure") {
        processor.message.error = new SessionV1.ContextOverflowError({
          message: `${configured.failure.message}. Original history preserved.`,
        }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        return "stop"
      }
      yield* session.updateMessage(processor.message)

      // Sized the way the next request will be: the system prompt, everything history now shows,
      // and the continuation that may follow.
      const cfg = yield* config.get()
      const userModel = yield* provider
        .getModel(prepared.userMessage.model.providerID, prepared.userMessage.model.modelID)
        .pipe(Effect.orDie)
      const overhead = input.overhead || (yield* reportedOverhead(input.messages, userModel))
      const before = overhead + (yield* estimate({ messages: input.messages, model: userModel }))
      const visible = yield* MessageV2.filterCompactedEffect(input.sessionID).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      const after =
        overhead + (yield* estimate({ messages: visible, model: userModel })) + Token.estimate(CompactionGuard.CONTINUE)
      // The tools tool_search loaded stay loaded: the next step reads them from this part.
      const carried = ToolSearch.carried(input.messages)
      if (prepared.compactionPart) {
        yield* session.updatePart({
          ...prepared.compactionPart,
          ...(prepared.selected.tail_start_id ? { tail_start_id: prepared.selected.tail_start_id } : {}),
          tokens: { before, after },
          ...(carried.loaded.length > 0 || carried.mcpDeferred ? { tools: carried } : {}),
        })
      }

      // Hysteresis: a checkpoint that leaves the next request above the band only buys one more
      // step before the next compaction, so two in a row pause automatic compaction.
      const current = yield* session.get(input.sessionID).pipe(Effect.orDie)
      const guard = CompactionGuard.fromMetadata(current.metadata)
      const effective = CompactionGuard.isEffective({
        after,
        usable: usable({ cfg, model: userModel, outputTokenMax: flags.outputTokenMax }),
      })
      const next = input.auto
        ? CompactionGuard.afterAutomatic(guard, {
            effective,
            latestRequestID: prepared.latestRequestID,
            turnID: prepared.turnID,
            now: Date.now(),
          })
        : { ineffective: 0 }
      if (input.auto) input.onMeasured?.(effective)
      if (JSON.stringify(next) !== JSON.stringify(guard))
        yield* session.updateMetadata(input.sessionID, (metadata) => CompactionGuard.toMetadata(metadata, next))
      const paused = input.auto && CompactionGuard.isPaused(next, prepared.latestRequestID)
      yield* Effect.logInfo("compacted", {
        "session.id": input.sessionID,
        before,
        after,
        effective,
        paused,
      })
      yield* Verbose.log("compaction.done", {
        sessionID: input.sessionID,
        auto: input.auto,
        before,
        after,
        effective,
        paused,
        result,
      })

      if (result === "continue" && input.auto && !paused) {
        if (prepared.replay) {
          const original = prepared.replay.info
          const replayMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: input.sessionID,
            time: { created: Date.now() },
            agent: original.agent,
            model: original.model,
            format: original.format,
            tools: original.tools,
            system: original.system,
          })
          for (const part of prepared.replay.parts) {
            if (part.type === "compaction") continue
            const replayPart =
              part.type === "file" && MessageV2.isMedia(part.mime)
                ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                : part
            yield* session.updatePart({
              ...replayPart,
              // Marked synthetic: the model still reads it, and the transcript stops showing
              // the person's own prompt a second time.
              ...(replayPart.type === "text" ? { synthetic: true } : {}),
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            })
          }
        }

        // Steers admitted while the summary was written are promoted at the next boundary; the
        // continuation hands the turn to them rather than letting it end on the summary.
        const handoff =
          !prepared.replay &&
          (yield* SessionInput.listPending(database.db, input.sessionID, { delivery: "steer" })).length > 0
        if (!prepared.replay && (handoff || midWork(input.messages, input.parentID, input.overflow))) {
          const info = yield* provider.getProvider(prepared.userMessage.model.providerID)
          if (
            (yield* plugin.trigger(
              "experimental.compaction.autocontinue",
              {
                sessionID: input.sessionID,
                agent: prepared.userMessage.agent,
                model: yield* provider
                  .getModel(prepared.userMessage.model.providerID, prepared.userMessage.model.modelID)
                  .pipe(Effect.orDie),
                provider: {
                  source: info.source,
                  info,
                  options: info.options,
                },
                message: prepared.userMessage,
                overflow: input.overflow === true,
              },
              { enabled: true },
            )).enabled
          ) {
            // Goals follow the same rule: a goal turn cut off mid-work continues and its next real
            // answer is judged; a goal turn that had already answered is judged on that answer.
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: prepared.userMessage.agent,
              model: prepared.userMessage.model,
            })
            const text =
              (input.overflow
                ? "The previous request exceeded the provider's context limit. The conversation was compacted and media attachments, if any, were removed from context. If the user was asking about attached images or files that are no longer available, say so and suggest smaller or fewer files.\n\n"
                : "") +
              CompactionGuard.CONTINUE +
              (handoff ? `\n\n${CompactionGuard.HANDOFF}` : "")
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              // Internal marker for auto-compaction followups so provider plugins
              // can distinguish them from manual post-compaction user prompts.
              // This is not a stable plugin contract and may change or disappear.
              metadata: { compaction_continue: true },
              synthetic: true,
              text,
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }
      }

      if (processor.message.error) return "stop"
      if (result === "continue") {
        yield* events.publish(Event.Compacted, { sessionID: input.sessionID })
      }
      if (paused && result === "continue") return "paused" as const
      return result
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      auto: boolean
      overflow?: boolean
      focus?: string
    }) {
      yield* Verbose.log("compaction.requested", {
        sessionID: input.sessionID,
        auto: input.auto,
        why: input.overflow ? "context overflow" : input.auto ? "threshold reached" : "requested",
        focused: Boolean(input.focus?.trim()),
      })
      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
        ...(input.focus?.trim() ? { focus: input.focus.trim() } : {}),
      })
    })

    return Service.of({
      isOverflow,
      prune,
      relieve,
      process: processCompaction,
      prepare,
      discard,
      create,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    LLM.node,
    Database.node,
    SessionGuardLog.node,
    Config.node,
    Session.node,
    Agent.node,
    Plugin.node,
    SessionProcessor.node,
    Provider.node,
    EventV2Bridge.node,
    OperationHookBridge.node,
    RuntimeFlags.node,
    ToolOutputBridge.node,
    SessionStatus.node,
    Intelligence.node,
  ],
})

export * as SessionCompaction from "./compaction"
