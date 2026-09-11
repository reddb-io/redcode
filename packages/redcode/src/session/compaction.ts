import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionGoal } from "./goal"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { ConfigV1 } from "@reddb-io/redcode-core/v1/config/config"
import { Session } from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"
import { SessionProcessor } from "./processor"
import { LLM } from "./llm"
import { LLMEvent } from "@reddb-io/redcode-llm"
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
import { buildPrompt, forkPreparation, summaryError, systemPrompt } from "@reddb-io/redcode-core/session/compaction"
import { SessionCompactionEvent } from "@reddb-io/redcode-schema/session-compaction-event"
import { OperationHook } from "@reddb-io/redcode-core/operation-hook"
import { SessionContextEpoch } from "@reddb-io/redcode-core/session/context-epoch"
import { OperationHookBridge } from "@/operation-hook-bridge"

export const Event = SessionCompactionEvent

export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const PRUNE_PROTECTED_TOOLS = ["skill"]
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 15_000
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
          ? "[Old tool result content cleared]"
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
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

function preserveRecentBudget(input: { cfg: ConfigV1.Info; model: Provider.Model }) {
  return (
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable(input) * 0.25)))
  )
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

type ProcessInput = {
  parentID: MessageID
  messages: SessionV1.WithParts[]
  sessionID: SessionID
  auto: boolean
  overflow?: boolean
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: SessionV1.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  readonly process: (input: ProcessInput) => Effect.Effect<"continue" | "stop">
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

      if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined }
      return {
        head: input.messages.slice(0, keep.start),
        tail_start_id: keep.id,
      }
    })

    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.prune) return
      yield* Effect.logInfo("pruning")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return

      let total = 0
      let pruned = 0
      const toPrune: SessionV1.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) break loop
          const estimate = Token.estimate(part.state.output)
          total += estimate
          if (total <= PRUNE_PROTECT) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      yield* Effect.logInfo("found", { pruned, total })
      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        yield* Effect.logInfo("pruned", { count: toPrune.length })
      }
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
      const model = agent.model
        ? yield* provider.getModel(agent.model.providerID, agent.model.modelID).pipe(Effect.orDie)
        : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID).pipe(Effect.orDie)
      const cfg = yield* config.get()
      const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
      const prior = completedCompactions(history)
      const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
      const previousSummary = prior.at(-1)?.summary
      const retained = history.filter((_, index) => !hidden.has(index))
      const selected = yield* select({ messages: retained, cfg, model })
      const latestRequest = (yield* session.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)).findLast(
        (message) =>
          message.info.role === "user" &&
          message.info.id <= input.messages.at(-1)!.info.id &&
          !message.parts.some((part) => part.type === "compaction") &&
          !isReplay(message.parts),
      )
      // Membership in the retained tail, not an id comparison: a promoted prompt keeps its
      // admission-time id but sits later in history, and would otherwise be summarised twice.
      const tailStart = selected.tail_start_id
        ? retained.findIndex((message) => message.info.id === selected.tail_start_id)
        : -1
      const inTail =
        latestRequest !== undefined &&
        tailStart >= 0 &&
        retained.slice(tailStart).some((message) => message.info.id === latestRequest.info.id)
      const preservedRequest =
        !replay && latestRequest && !inTail
          ? `\n\n<latest-user-request>\n${serialize(latestRequest)}\n</latest-user-request>`
          : ""
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
      const conversation = msgs.map(serialize).filter(Boolean).join("\n\n")
      const nextPrompt =
        compacting.prompt ??
        [
          buildPrompt({
            previousSummary,
            context: [conversation],
          }),
          ...compacting.context,
        ]
          .filter(Boolean)
          .join("\n\n")
      return {
        userMessage,
        compactionPart,
        replay,
        agent,
        model,
        selected,
        preservedRequest,
        previousSummary,
        conversation,
        stream: {
          user: userMessage,
          agent,
          sessionID: input.sessionID,
          tools: {},
          system: [systemPrompt],
          model,
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
            source: [prepared.previousSummary, prepared.conversation].filter(Boolean).join("\n\n"),
            retained: prepared.preservedRequest,
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

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: ProcessInput) {
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
            yield* provider.getModel(parent.info.model.providerID, parent.info.model.modelID).pipe(Effect.orDie),
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
      const processor = yield* processors.create({
        assistantMessage: msg,
        sessionID: input.sessionID,
        model: prepared.model,
      })
      // The turn's watchdog reads the step handle, and this processor is not it, so a provider
      // that stops answering here holds the turn open with nothing to show. A compaction that did
      // not happen is reported as itself rather than as silence.
      const compactionMs = AuxDeadline.deadlineMs("compaction", (yield* config.get()).experimental?.aux_timeout)
      const result = yield* processor
        .process({ ...prepared.stream, user: prepared.userMessage }, candidate?.events)
        .pipe(
          compactionMs === undefined
            ? (self) => self
            : Effect.timeoutOrElse({
                duration: Duration.millis(compactionMs),
                orElse: () =>
                  Effect.gen(function* () {
                    yield* guards.record({
                      sessionID: input.sessionID,
                      guard: "aux",
                      action: "stop",
                      subject: "compaction",
                      detail: AuxDeadline.message("compaction", compactionMs),
                    })
                    yield* Effect.logWarning(AuxDeadline.message("compaction", compactionMs), {
                      "session.id": input.sessionID,
                    })
                    processor.message.error = new SessionV1.ContextOverflowError({
                      message: AuxDeadline.message("compaction", compactionMs),
                    }).toObject()
                    processor.message.finish = "error"
                    yield* session.updateMessage(processor.message)
                    return "stop" as const
                  }),
              }),
        )

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
      const error = summaryError({
        summary: summaryText(checkpoint) ?? "",
        retained: prepared.preservedRequest,
        source: [prepared.previousSummary, prepared.conversation].filter(Boolean).join("\n\n"),
        finish: processor.message.finish,
      })
      if (error) {
        processor.message.error = new SessionV1.ContextOverflowError({ message: error }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        return "stop"
      }
      if (prepared.preservedRequest) {
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: input.sessionID,
          type: "text",
          synthetic: true,
          text: prepared.preservedRequest,
        })
      }

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
      yield* session.updateMessage(processor.message)

      if (result === "continue" && input.auto) {
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

        if (!prepared.replay) {
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
            // While a goal is active the goal loop decides what the next turn is; two synthetic
            // continuations would interleave.
            const goalActive =
              SessionGoal.fromMetadata((yield* session.get(input.sessionID).pipe(Effect.orDie)).metadata)?.status ===
              "active"
            if (goalActive) return "continue"
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
                ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
                : "") +
              "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
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
      return result
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      auto: boolean
      overflow?: boolean
    }) {
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
      })
    })

    return Service.of({
      isOverflow,
      prune,
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
  ],
})

export * as SessionCompaction from "./compaction"
