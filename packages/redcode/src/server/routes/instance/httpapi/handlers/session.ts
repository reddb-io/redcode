import { PermissionV1 } from "@reddb-io/redcode-core/v1/permission"
import { Agent } from "@/agent/agent"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Command } from "@/command"
import { Permission } from "@/permission"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionV2 } from "@reddb-io/redcode-core/session"
import { SessionMessage } from "@reddb-io/redcode-core/session/message"
import { SessionInput } from "@reddb-io/redcode-schema/session-input"
import { SessionGoal } from "@/session/goal"
import { GoalRuntime } from "@/session/goal-runtime"
import { GoalCommand } from "@reddb-io/redcode-core/session/goal-command"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { SessionBudget } from "@/session/budget"
import { SessionSpend } from "@/session/spend"
import { Config } from "@/config/config"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionModelSwitch } from "@/session/model-switch"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { NamedError } from "@reddb-io/redcode-core/util/error"
import { Cause, Effect, Option, Schema, Scope } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect/instance-state"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  CommandPayload,
  DiffQuery,
  ForkPayload,
  GoalBudgetPayload,
  GoalCommandPayload,
  InitPayload,
  SessionBudgetPayload,
  ListQuery,
  MessagesQuery,
  PermissionResponsePayload,
  PromptDeliveryPayload,
  PromptPayload,
  RevertPayload,
  ShellPayload,
  SummarizePayload,
  UpdatePayload,
} from "../groups/session"
import { InvalidRequestError, notFound, PermissionNotFoundError } from "../errors"
import * as SessionError from "./session-errors"

const tryParseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new HttpApiError.BadRequest({}),
  })


/** The V2 engine admission: converts the V1 prompt payload, admits durably and drains through the
 * V2 runner when `experimental.session_engine` is `v2`. The mirrored user message (the projector
 * republishes V1 wire events from the durable log) reaches clients through the same paths as V1. */
const admitV2 = Effect.fn("SessionHttpApi.admitV2")(function* (
  sessions: SessionV2.Interface,
  input: {
    readonly sessionID: SessionID
    readonly messageID?: MessageID
    readonly agent?: string
    readonly model?: { providerID: string; modelID: string }
    readonly delivery?: typeof SessionInput.Delivery.Type
    readonly noReply?: boolean
    readonly parts: ReadonlyArray<
      | { readonly type: "text"; readonly text: string; readonly synthetic?: boolean }
      | { readonly type: "file"; readonly mime: string; readonly filename?: string; readonly url: string }
      | { readonly type: "agent"; readonly name: string }
      | { readonly type: "subtask"; readonly prompt: string; readonly agent: string }
    >
  },
) {
  const files = input.parts.flatMap((part) => (part.type === "file" ? [part] : []))
  const agents = input.parts.flatMap((part) => (part.type === "agent" ? [part] : []))
  const text = input.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : part.type === "subtask" ? [part.prompt] : []))
    .join("\n\n")
  const admitted = yield* sessions
    .prompt({
      sessionID: input.sessionID,
      prompt: {
        text,
        ...(files.length
          ? {
              files: files.map((file) => ({
                uri: file.url,
                mime: file.mime,
                ...(file.filename ? { name: file.filename } : {}),
              })),
            }
          : {}),
        ...(agents.length ? { agents: agents.map((agent) => ({ name: agent.name })) } : {}),
      },
      ...(input.messageID ? { id: SessionMessage.ID.make(input.messageID) } : {}),
      ...(input.delivery ? { delivery: input.delivery } : {}),
      // `noReply` admits without draining: the V1 loop's contract, now the V2 admit-only mode.
      ...(input.noReply ? { resume: false } : {}),
    })
    .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
  // The V1 prompt contract returns the user message; build it from the admitted prompt instead of
  // racing the projector, which materializes the mirrored row asynchronously.
  const now = Date.now()
  const info = {
    id: admitted.id,
    sessionID: input.sessionID,
    role: "user" as const,
    time: { created: now },
    agent: input.agent ?? "build",
    model: {
      providerID: input.model?.providerID ?? "",
      modelID: input.model?.modelID ?? "",
    },
  }
  const parts = [
    {
      id: `prt_${admitted.id}`,
      type: "text" as const,
      sessionID: input.sessionID,
      messageID: admitted.id,
      text,
      time: { start: now },
    },
    ...files.flatMap((file, index) => [
      {
        id: `prt_${admitted.id}:file:${index}`,
        type: "file" as const,
        sessionID: input.sessionID,
        messageID: admitted.id,
        mime: file.mime,
        ...(file.filename ? { filename: file.filename } : {}),
        url: file.url,
      },
    ]),
  ]
  return { admitted, info, parts }
})

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const shareSvc = yield* SessionShare.Service
    const promptSvc = yield* SessionPrompt.Service
    const sessionV2 = yield* SessionV2.Service
    const goals = yield* GoalRuntime.Service
    const intelligence = yield* Intelligence.Service
    const spend = yield* SessionSpend.Service
    const config = yield* Config.Service
    const revertSvc = yield* SessionRevert.Service
    const compactSvc = yield* SessionCompaction.Service
    const runState = yield* SessionRunState.Service
    const agentSvc = yield* Agent.Service
    const permissionSvc = yield* Permission.Service
    const statusSvc = yield* SessionStatus.Service
    const switches = yield* SessionModelSwitch.Service
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service
    const events = yield* EventV2Bridge.Service
    const scope = yield* Scope.Scope

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      const directory = ctx.query.directory ? yield* InstanceState.directory : undefined
      return yield* session.list({
        directory: ctx.query.scope === "project" ? undefined : directory,
        scope: ctx.query.scope,
        path: ctx.query.path,
        roots: ctx.query.roots,
        start: ctx.query.start,
        search: ctx.query.search,
        limit: ctx.query.limit,
      })
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      return yield* SessionError.mapStorageNotFound(session.get(sessionID))
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* session.children(ctx.params.sessionID)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      if (ctx.query.before && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
      if (ctx.query.before) {
        const before = ctx.query.before
        yield* Effect.try({
          try: () => MessageV2.cursor.decode(before),
          catch: () => new HttpApiError.BadRequest({}),
        })
      }
      yield* requireSession(ctx.params.sessionID)
      if (ctx.query.limit === undefined || ctx.query.limit === 0) {
        return yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      }

      const page = yield* SessionError.mapStorageNotFound(
        MessageV2.page({
          sessionID: ctx.params.sessionID,
          limit: ctx.query.limit,
          before: ctx.query.before,
        }),
      )
      if (!page.cursor) return page.items

      const request = yield* HttpServerRequest.HttpServerRequest
      // toURL() honors the Host + x-forwarded-proto headers, so the Link
      // header echoes the real origin instead of a hard-coded localhost.
      const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
      url.searchParams.set("limit", ctx.query.limit.toString())
      url.searchParams.set("before", page.cursor)
      return HttpServerResponse.jsonUnsafe(page.items, {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
          Link: `<${url.toString()}>; rel="next"`,
          "X-Next-Cursor": page.cursor,
        },
      })
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      return yield* SessionError.mapStorageNotFound(
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
      )
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      return yield* shareSvc.create(ctx.payload)
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* tryParseJson(body)
      const decoded = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      const payload = decoded
        ? {
            ...decoded,
            permission: decoded.permission ? [...decoded.permission] : undefined,
          }
        : decoded
      return yield* create({ payload })
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* SessionError.mapStorageNotFound(session.remove(ctx.params.sessionID))
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (ctx.payload.title !== undefined) {
        yield* session.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
      }
      if (ctx.payload.metadata !== undefined) {
        yield* session.setMetadata({ sessionID: ctx.params.sessionID, metadata: ctx.payload.metadata })
      }
      if (ctx.payload.permission !== undefined) {
        yield* session.setPermission({
          sessionID: ctx.params.sessionID,
          permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
        })
      }
      if (ctx.payload.time?.archived !== undefined) {
        yield* session.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
      }
      if (ctx.payload.model !== undefined) {
        yield* session.setAgentModel({
          sessionID: ctx.params.sessionID,
          agent: current.agent ?? (yield* agentSvc.defaultInfo()).name,
          model: {
            id: ctx.payload.model.modelID,
            providerID: ctx.payload.model.providerID,
            variant: ctx.payload.model.variant ?? "default",
          },
          time: Date.now(),
        })
        yield* switches.select(ctx.params.sessionID, ctx.payload.model)
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      return yield* SessionError.mapStorageNotFound(
        session.fork({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload?.messageID,
        }),
      )
    })

    const forkRaw = Effect.fn("SessionHttpApi.forkRaw")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* fork({ params: ctx.params })

      const json = yield* tryParseJson(body)
      const payload = yield* Schema.decodeUnknownEffect(ForkPayload)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* fork({ params: ctx.params, payload })
    })

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* promptSvc.cancel(ctx.params.sessionID)
      return true
    })

    /** The agent of the last user message, or the default: a goal continues the conversation it lands in. */
    const goalAgent = Effect.fn("SessionHttpApi.goalAgent")(function* (sessionID: SessionID) {
      const messages = yield* SessionError.mapStorageNotFound(session.messages({ sessionID }))
      return (
        messages.findLast((message) => message.info.role === "user")?.info.agent ?? (yield* agentSvc.defaultAgent())
      )
    })

    const goalGet = Effect.fn("SessionHttpApi.goalGet")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return (yield* goals.get(ctx.params.sessionID)) ?? null
    })

    const goalSet = Effect.fn("SessionHttpApi.goalSet")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: { text: string; max_turns?: number; agent?: string; max_cost_usd?: number; max_tokens?: number }
    }) {
      yield* requireSession(ctx.params.sessionID)
      const text = ctx.payload.text.trim()
      if (!text) return yield* new HttpApiError.BadRequest()
      const cfg = yield* config.get()
      const agent = ctx.payload.agent ?? (yield* goalAgent(ctx.params.sessionID))
      const { goal, warnings } = SessionGoal.parseWithWarnings(text, {
        maxTurns: ctx.payload.max_turns ?? cfg.experimental?.goal?.max_turns,
        stopAfter: agent === "design" ? "design" : agent === "plan" ? "plan" : "build",
        // Only what the person asked for: a goal has no spend limit by default.
        budget: SessionBudget.limitsOf({ max_cost_usd: ctx.payload.max_cost_usd, max_tokens: ctx.payload.max_tokens }),
      })
      if (!goal.objective) return yield* new InvalidRequestError({ message: SessionGoal.NEEDS_OBJECTIVE, field: "text" })
      yield* goals.set(ctx.params.sessionID, goal)
      // The goal's first turn is the objective itself, as the user's message: the loop takes it
      // from there. Forked into the server's scope — not the request's, which closes with the
      // response and would take the turn with it — so the request answers at once.
      yield* promptSvc
        .prompt({
          sessionID: ctx.params.sessionID,
          agent,
          parts: [
            {
              type: "text",
              text: `${goal.objective}\n\n(This is the goal of this session; the goal block carries the full contract.)`,
            },
          ],
        })
        .pipe(
          Effect.catchCause((cause) => Effect.logError("goal could not start", { cause })),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      return { ...((yield* goals.get(ctx.params.sessionID)) ?? goal), ...(warnings.length ? { warnings } : {}) }
    })

    const goalPause = Effect.fn("SessionHttpApi.goalPause")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      // Pause before cancelling: cancel pauses an active goal as "interrupted", and the reason
      // the user sees should be their own.
      const paused = (yield* goals.pause(ctx.params.sessionID, "paused by the user")) ?? null
      yield* promptSvc.cancel(ctx.params.sessionID)
      return paused
    })

    const goalResume = Effect.fn("SessionHttpApi.goalResume")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      const goal = yield* goals.get(ctx.params.sessionID)
      if (!goal) return null
      if (goal.status === "done" || goal.status === "dropped") return yield* new HttpApiError.BadRequest()
      const sessionBudget = yield* spend.view(ctx.params.sessionID)
      const next = SessionGoal.resumed(goal, Date.now(), yield* spend.totals(ctx.params.sessionID), sessionBudget)
      yield* goals.set(ctx.params.sessionID, next)
      if (next.status !== "active") return next
      const agent = yield* goalAgent(ctx.params.sessionID)
      yield* promptSvc
        .prompt({
          sessionID: ctx.params.sessionID,
          agent,
          parts: [
            {
              type: "text",
              text: SessionGoal.continuation(next, { reason: goal.reason ?? "resumed by the user" }),
              synthetic: true,
            },
          ],
        })
        .pipe(
          Effect.catchCause((cause) => Effect.logError("goal could not resume", { cause })),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      return next
    })

    const goalDrop = Effect.fn("SessionHttpApi.goalDrop")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      const goal = yield* goals.get(ctx.params.sessionID)
      if (!goal) return false
      yield* goals.set(ctx.params.sessionID, {
        ...goal,
        status: "dropped",
        reason: "dropped by the user",
        updated: Date.now(),
      })
      if (goal.status === "active") yield* promptSvc.cancel(ctx.params.sessionID)
      return true
    })

    const goalBudget = Effect.fn("SessionHttpApi.goalBudget")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof GoalBudgetPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const goal = yield* goals.get(ctx.params.sessionID)
      if (!goal) return null
      const { max_turns } = ctx.payload
      const budget = SessionBudget.update(goal.budget, ctx.payload)
      const { budget: _previous, ...rest } = goal
      const next: SessionGoal.Goal = {
        ...rest,
        turns: max_turns === undefined ? goal.turns : { ...goal.turns, max: Math.max(1, Math.floor(max_turns)) },
        ...(SessionBudget.hasLimits(budget) ? { budget } : {}),
        updated: Date.now(),
      }
      yield* goals.set(ctx.params.sessionID, next)
      return next
    })

    const goalCommand = Effect.fn("SessionHttpApi.goalCommand")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof GoalCommandPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const goal = yield* goals.get(ctx.params.sessionID)
      // Unreadable settings classify, and a failed classification asks: nothing is guessed.
      const mode = yield* intelligence.read().pipe(
        Effect.map(Intelligence.mode),
        Effect.orElseSucceed(() => "dual" as const),
      )
      return yield* GoalCommand.resolve({
        text: ctx.payload.text,
        mode,
        status: goal?.status,
        classify: intelligence.evaluate(
          GoalCommand.evaluation({ sessionID: ctx.params.sessionID, text: ctx.payload.text, goal }),
        ),
      })
    })

    const budgetGet = Effect.fn("SessionHttpApi.budget")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* spend.view(ctx.params.sessionID)
    })

    const budgetSet = Effect.fn("SessionHttpApi.budgetSet")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SessionBudgetPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* spend.setLimits(ctx.params.sessionID, ctx.payload)
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* promptSvc
        .command({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload.messageID,
          model: `${ctx.payload.providerID}/${ctx.payload.modelID}`,
          command: Command.Default.INIT,
          arguments: "",
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    // share/unshare errors aren't all client-induced — storage and network
    // failures from SessionShare are real possibilities. Map to a typed 500
    // (matches the legacy route behavior which routed any failure through
    // ErrorMiddleware → NamedError.Unknown 500) instead of blanket-mapping
    // every failure to a 400 BadRequest.
    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc
        .unshare(ctx.params.sessionID)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      yield* revertSvc.cleanup(yield* requireSession(ctx.params.sessionID))
      const messages = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      const defaultAgent = yield* agentSvc.defaultAgent()
      const currentAgent = messages.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent

      yield* compactSvc.create({
        sessionID: ctx.params.sessionID,
        agent: currentAgent,
        model: {
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
        },
        auto: ctx.payload.auto ?? false,
        ...(ctx.payload.focus?.trim() ? { focus: ctx.payload.focus.trim() } : {}),
      })
      yield* promptSvc.loop({ sessionID: ctx.params.sessionID })
      return true
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const cfg = yield* config.get()
      if (cfg.experimental?.session_engine === "v2") {
        const { info, parts } = yield* admitV2(sessionV2, { ...ctx.payload, sessionID: ctx.params.sessionID })
        return HttpServerResponse.stream(Stream.make(JSON.stringify({ ...info, parts })).pipe(Stream.encodeText), {
          contentType: "application/json",
        })
      }
      const message = yield* promptSvc
        .prompt({
          ...ctx.payload,
          sessionID: ctx.params.sessionID,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return HttpServerResponse.stream(Stream.make(JSON.stringify(message)).pipe(Stream.encodeText), {
        contentType: "application/json",
      })
    })

    // Answers once the prompt is admitted, so a client learns whether it landed and can retry the
    // same messageID when it did not; the turn runs detached, in the service scope.
    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const cfg = yield* config.get()
      if (cfg.experimental?.session_engine === "v2") {
        yield* admitV2(sessionV2, { ...ctx.payload, sessionID: ctx.params.sessionID })
        // The V2 runner schedules its own drain; `resume: false` already handled the admit-only case.
        return HttpApiSchema.NoContent.make()
      }
      yield* promptSvc
        .prompt({ ...ctx.payload, sessionID: ctx.params.sessionID, noReply: true })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      if (ctx.payload.noReply === true) return HttpApiSchema.NoContent.make()
      yield* promptSvc.loop({ sessionID: ctx.params.sessionID }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("prompt_async failed", { sessionID: ctx.params.sessionID, cause })
            yield* events.publish(Session.Event.Error, {
              sessionID: ctx.params.sessionID,
              error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
            })
          }),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      )
      return HttpApiSchema.NoContent.make()
    })

    const promptDelivery = Effect.fn("SessionHttpApi.promptDelivery")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
      payload: typeof PromptDeliveryPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const row = yield* promptSvc.setDelivery({
        sessionID: ctx.params.sessionID,
        messageID: ctx.params.messageID,
        delivery: ctx.payload.delivery,
      })
      if (row === undefined) return yield* notFound(`Prompt is not pending: ${ctx.params.messageID}`)
      return HttpApiSchema.NoContent.make()
    })

    const pendingPrompts = Effect.fn("SessionHttpApi.pendingPrompts")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc.pending(ctx.params.sessionID)
    })

    const promptDiscard = Effect.fn("SessionHttpApi.promptDiscard")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      const discarded = yield* promptSvc.discard({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID })
      if (!discarded) return yield* notFound(`Prompt is not pending: ${ctx.params.messageID}`)
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc
        .command({ ...ctx.payload, sessionID: ctx.params.sessionID })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(promptSvc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID }))
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload }))
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.unrevert({ sessionID: ctx.params.sessionID }))
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionV1.ID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* permissionSvc.reply({ requestID: ctx.params.permissionID, reply: ctx.payload.response }).pipe(
        Effect.catchTag("Permission.NotFoundError", (error) =>
          Effect.fail(
            new PermissionNotFoundError({
              requestID: String(error.requestID),
              message: `Permission request not found: ${error.requestID}`,
            }),
          ),
        ),
      )
      return true
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* SessionError.mapBusy(runState.assertNotBusy(ctx.params.sessionID))
      yield* session.removeMessage(ctx.params)
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* session.removePart(ctx.params)
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof SessionV1.Part.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const payload = ctx.payload as SessionV1.Part
      if (
        payload.id !== ctx.params.partID ||
        payload.messageID !== ctx.params.messageID ||
        payload.sessionID !== ctx.params.sessionID
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* session.updatePart(payload)
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
      .handle("diff", diff)
      .handle("messages", messages)
      .handle("message", message)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handleRaw("fork", forkRaw)
      .handle("abort", abort)
      .handle("init", init)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", summarize)
      .handle("goal", goalGet)
      .handle("goalSet", goalSet)
      .handle("goalPause", goalPause)
      .handle("goalResume", goalResume)
      .handle("goalDrop", goalDrop)
      .handle("goalBudget", goalBudget)
      .handle("goalCommand", goalCommand)
      .handle("budget", budgetGet)
      .handle("budgetSet", budgetSet)
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("promptDelivery", promptDelivery)
      .handle("pendingPrompts", pendingPrompts)
      .handle("promptDiscard", promptDiscard)
      .handle("command", command)
      .handle("shell", shell)
      .handle("revert", revert)
      .handle("unrevert", unrevert)
      .handle("permissionRespond", permissionRespond)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
  }),
)
