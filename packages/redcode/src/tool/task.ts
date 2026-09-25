import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect, Exit, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionGoal } from "@/session/goal"
import { Todo } from "../session/todo"
import { Permission } from "../permission"
import { Intelligence } from "@reddb-io/redcode-core/intelligence"
import { SessionPlan } from "@reddb-io/redcode-core/session/plan"
import { SubagentReview } from "@reddb-io/redcode-core/session/subagent-review"
import { SessionStopLoss } from "@reddb-io/redcode-core/session/stop-loss"
import { SessionSpend } from "@/session/spend"
import type { PermissionV1 } from "@reddb-io/redcode-core/v1/permission"
import { ReasoningAuto } from "@reddb-io/redcode-core/session/reasoning-auto"
import { Provider } from "@/provider/provider"
import { closest, runnable, selectable } from "./models"
import { HookV2Bridge } from "@/hook-v2-bridge"

export interface TaskPromptOps {
  notify?(input: SessionPrompt.PromptInput): Effect.Effect<boolean>
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
].join(" ")
const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")
const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  scope: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Globs, relative to the project root, of the files and directories the subagent may change, e.g. packages/core/src/session/**. Expected for agents that can edit files or run commands; name the non-goals in the prompt.",
  }),
  done_criteria: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Observable conditions that mean the task is done, one per entry, e.g. bun test test/session passes, or every caller of foo() is listed.",
  }),
  return_format: Schema.optional(Schema.String).annotate({
    description:
      "What the subagent must hand back and in what shape, e.g. a list of file:line findings with one line of explanation each.",
  }),
  model: Schema.optional(Schema.String).annotate({
    description:
      "Only when the user asks for a particular model: the model the subagent runs on, as providerID/modelID. Look it up with the models tool, your own provider first; never guess an id. Left out, the subagent runs on its agent's configured model, else on yours.",
  }),
  variant: Schema.optional(Schema.String).annotate({
    description:
      "Only when the user asks for a reasoning level: the variant of the subagent's model to run, as the models tool lists it, e.g. high. Left out, your own variant carries over where the subagent's model has it.",
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})

/** Tools whose permission tells the brief reviewer what the subagent may do. */
const REVIEWED_PERMISSIONS = ["read", "edit", "bash", "webfetch", "task"]

function renderOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  review?: SubagentReview.Review
  result?: SubagentReview.ResultReview
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  const note = input.review && SubagentReview.note(input.review)
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    ...(input.review && note ? [`<brief_review verdict="${input.review.verdict}">${note}</brief_review>`] : []),
    ...(input.result ? [SubagentReview.reviewBlock(input.result)] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const intelligence = yield* Intelligence.Service
    const todos = yield* Todo.Service
    const plans = yield* SessionPlan.Service
    const spend = yield* SessionSpend.Service
    const provider = yield* Provider.Service
    const hooks = yield* HookV2Bridge.Service
    // Foreground subagents running per parent session. Checked and taken in one synchronous step,
    // so parallel task calls in one message cannot all slip under the cap.
    const running = new Map<SessionID, number>()

    /**
     * An S1 evaluation on the parent's behalf. Its spend is the parent's, charged once: a record the
     * engine reused from its cache was charged when it was made. Failing to evaluate is never an
     * error here; the caller labels the missing verdict.
     */
    const evaluate = Effect.fn("TaskTool.evaluate")(function* (input: Intelligence.EvaluationInput) {
      const started = Date.now()
      const record = yield* intelligence.evaluate(input).pipe(Effect.orElseSucceed(() => undefined))
      if (record && record.created >= started)
        yield* spend.recordEvaluation({ sessionID: input.sessionID, usage: record.usage })
      return record
    })

    /** The model a call names, among the connected providers; an unknown one fails with the closest ids. */
    const requireModel = Effect.fn("TaskTool.requireModel")(function* (text: string) {
      const ref = Provider.parseModel(text.trim())
      const found = yield* provider.getModel(ref.providerID, ref.modelID).pipe(Effect.orElseSucceed(() => undefined))
      if (found && runnable(found)) return found
      if (found)
        return yield* Effect.fail(
          new Error(`${text} is a System One evaluator or a deprecated model; a subagent cannot run on it.`),
        )
      const close = closest(selectable(yield* provider.list()), text)
      return yield* Effect.fail(
        new Error(
          [
            `Unknown model "${text}": no connected provider serves it.`,
            ...(close.length ? [`Close matches: ${close.join(", ")}.`] : []),
            'Pass it as "providerID/modelID"; the models tool searches the available models.',
          ].join(" "),
        ),
      )
    })

    /**
     * The model a subagent runs on: the one the call names, else its agent's, else the parent's. A
     * variant the call names must exist on that model; an inherited one is dropped where it does not.
     */
    const resolveModel = Effect.fn("TaskTool.resolveModel")(function* (input: {
      model?: string
      variant?: string
      agent: Agent.Info
      parent: NonNullable<Agent.Info["model"]>
      parentVariant?: string
    }) {
      const explicit = input.model === undefined ? undefined : yield* requireModel(input.model)
      const source = explicit ? "explicit" : input.agent.model ? "agent" : "parent"
      const model = explicit
        ? { providerID: explicit.providerID, modelID: explicit.id }
        : (input.agent.model ?? input.parent)
      // The parent's variant was chosen for the parent's model, so on that model it needs no check.
      if (input.variant === undefined && source === "parent") return { model, variant: input.parentVariant, source }
      const info =
        explicit ??
        (yield* provider.getModel(model.providerID, model.modelID).pipe(Effect.orElseSucceed(() => undefined)))
      const choices = ReasoningAuto.options(Object.keys(info?.variants ?? {}))
      if (input.variant !== undefined && !choices.includes(input.variant)) {
        const ref = `${model.providerID}/${model.modelID}`
        return yield* Effect.fail(
          new Error(
            choices.length
              ? `Variant "${input.variant}" is not available for ${ref}. Available: ${choices.join(", ")}.`
              : `${ref} has no variants. Leave variant out.`,
          ),
        )
      }
      const inherited = source === "agent" ? input.agent.variant : input.parentVariant
      const variant = input.variant ?? (inherited !== undefined && choices.includes(inherited) ? inherited : undefined)
      return { model, variant, source }
    })

    /**
     * Whether the brief is good enough to launch on. Structure is checked in every mode; dual
     * reasoning also asks S1 against the user's request. A rejection fails the tool so the parent
     * revises; one revision per request and agent type, after which the task proceeds with a warning.
     * S1 that is unavailable or undecided never approves silently: the task proceeds, labelled.
     */
    const reviewBrief = Effect.fn("TaskTool.reviewBrief")(function* (input: {
      params: Schema.Schema.Type<typeof Parameters>
      ctx: Tool.Context
      parent: Session.Info
      agent: Agent.Info
      permission: PermissionV1.Ruleset
      writeCapable: boolean
      request: ReturnType<typeof latestRequest>
    }) {
      const findings = SubagentReview.briefStructure({
        prompt: input.params.prompt,
        scope: input.params.scope,
        doneCriteria: input.params.done_criteria,
        returnFormat: input.params.return_format,
        writeCapable: input.writeCapable,
      })
      const blocking = findings.filter((finding) => finding.blocking)
      if (blocking.length) {
        return yield* Effect.fail(
          new Error(
            SubagentReview.rejection(input.agent.name, {
              verdict: "needs_revision",
              issues: blocking.map((finding) => finding.id),
              findings: blocking,
            }),
          ),
        )
      }
      const settings = yield* intelligence.read().pipe(Effect.orElseSucceed(() => Intelligence.defaults))
      if (Intelligence.mode(settings) === "single")
        return { verdict: "unverified", issues: findings.map((finding) => finding.id), findings } as const

      const subjectID = `${input.request.id}:${input.agent.name}`
      const rejected = yield* intelligence
        .history(input.ctx.sessionID, { operation: "subagent_brief", subjectID, decision: "needs_revision" })
        .pipe(Effect.orElseSucceed(() => []))
      const goal = SessionGoal.fromMetadata(input.parent.metadata)
      const plan = (yield* plans.list(input.ctx.sessionID))
        .filter((item) => item.status === "approved")
        .toSorted((a, b) => b.created - a.created)[0]
      const record = yield* evaluate({
        sessionID: input.ctx.sessionID,
        operation: "subagent_brief",
        subjectID,
        attempt: rejected.length,
        sources: {
          requests: Intelligence.evidence(input.request.texts, { reference: input.ctx.sessionID, limit: 16_000 }),
          goal: goal?.status === "active" ? { objective: goal.objective } : undefined,
          todos: (yield* todos.get(input.ctx.sessionID)).map((todo) => ({
            content: todo.content,
            status: todo.status,
          })),
          plan: plan
            ? {
                path: plan.path,
                tasks: plan.tasks?.map((task) => ({ content: task.content, criterion: task.criterion })),
              }
            : undefined,
          agent: {
            name: input.agent.name,
            description: input.agent.description,
            write_capable: input.writeCapable,
            permissions: Object.fromEntries(
              REVIEWED_PERMISSIONS.map((item) => [item, Permission.evaluate(item, "*", input.permission).action]),
            ),
          },
          structure: findings.map((finding) => finding.message),
        },
        candidate: {
          description: input.params.description,
          prompt: Intelligence.evidence(input.params.prompt, { limit: 16_000 }),
          scope: input.params.scope,
          done_criteria: input.params.done_criteria,
          return_format: input.params.return_format,
          ...(input.params.model ? { model: input.params.model } : {}),
          ...(input.params.variant ? { variant: input.params.variant } : {}),
        },
        // Only a brief that picks a model is asked whether the user wanted it.
        questions:
          input.params.model || input.params.variant
            ? { ...SubagentReview.briefQuestions, ...SubagentReview.modelQuestions }
            : SubagentReview.briefQuestions,
      })

      if (!record || record.decision === "unavailable")
        return {
          verdict: "inconclusive",
          issues: [],
          // The engine's wording is for gates that keep a previous state; a brief has none.
          unavailable: record?.issues[0]?.replace(/ Previous state preserved\.$/, "") ?? "System One is not enabled",
          findings,
          ...(record ? { evaluationID: record.id } : {}),
        } as const
      if (record.decision === "accepted") return { verdict: "verified", issues: [], evaluationID: record.id } as const
      if (record.decision === "inconclusive")
        return { verdict: "inconclusive", issues: record.issues, evaluationID: record.id } as const
      if (!rejected.length) {
        return yield* Effect.fail(
          new Error(
            SubagentReview.rejection(input.agent.name, {
              verdict: "needs_revision",
              issues: record.issues,
              evaluationID: record.id,
            }),
          ),
        )
      }
      return { verdict: "needs_revision", issues: record.issues, evaluationID: record.id } as const
    })

    /**
     * Whether the subagent's result holds up against its brief. Mechanical checks run in every mode;
     * dual reasoning then asks S1 with the brief and a bounded digest of the subagent's tool calls,
     * unless a blocking finding already settles it. S1 that fails leaves the result unverified.
     */
    const reviewResult = Effect.fn("TaskTool.reviewResult")(function* (input: {
      sessionID: SessionID
      child: Session.Info
      brief: SubagentReview.Brief
      prompt: string
      /** The first message of this run in the child; everything from it on is this run's evidence. */
      from: MessageID
      replies: ReadonlyArray<SessionV1.WithParts>
      repaired: boolean
    }) {
      const persisted = yield* sessions.messages({ sessionID: input.child.id }).pipe(Effect.orElseSucceed(() => []))
      const reply = input.replies.at(-1)!
      const text = reply.parts.findLast((part) => part.type === "text")?.text ?? ""
      const parts = [
        ...persisted.filter(
          (message) => message.info.id >= input.from && !input.replies.some((item) => item.info.id === message.info.id),
        ),
        ...input.replies,
      ]
        .filter((message) => message.info.role === "assistant")
        .toSorted((a, b) => (a.info.id < b.info.id ? -1 : a.info.id > b.info.id ? 1 : 0))
        .flatMap((message) => message.parts)
      const findings = SubagentReview.resultChecks(
        { text, parts },
        {
          criteria: input.brief.criteria,
          scope: input.brief.scope,
          changesRequested: input.brief.writeCapable,
          directory: input.child.directory,
        },
      )
      const settings = yield* intelligence.read().pipe(Effect.orElseSucceed(() => Intelligence.defaults))
      const single = Intelligence.mode(settings) === "single"
      if (single || findings.some((finding) => finding.blocking))
        return SubagentReview.judge({ findings, single, repaired: input.repaired })
      const evaluation = yield* evaluate({
        sessionID: input.sessionID,
        operation: "subagent_result",
        subjectID: input.child.id,
        candidateID: reply.info.id,
        attempt: input.repaired ? 1 : 0,
        sources: {
          brief: {
            prompt: Intelligence.evidence(input.brief.brief, { limit: 8_000 }),
            // A resumed task runs a new prompt under the brief it was launched with.
            ...(input.prompt !== input.brief.brief
              ? { latest_prompt: Intelligence.evidence(input.prompt, { limit: 4_000 }) }
              : {}),
            scope: input.brief.scope,
            done_criteria: input.brief.criteria,
            return_format: input.brief.returnFormat,
            write_capable: input.brief.writeCapable,
          },
          checks: findings.map((finding) => finding.message),
          tool_calls: Intelligence.evidence(SubagentReview.digest(parts, { directory: input.child.directory }), {
            reference: `${input.child.id}/tool-calls`,
            limit: 16_000,
          }),
        },
        candidate: Intelligence.evidence(text, { reference: reply.info.id, limit: 12_000 }),
        questions: SubagentReview.resultQuestions,
      })
      return SubagentReview.judge({ findings, evaluation, single: false, repaired: input.repaired })
    })

    const unreviewed: { review?: Pick<SubagentReview.ResultReview, "decision" | "issues" | "repaired"> } = {}

    /** The verdict on the child's latest result, when its parent reviews it. */
    const resultOf = (sessionID: SessionID) =>
      sessions.get(sessionID).pipe(
        Effect.map((session) => {
          const brief = SubagentReview.fromMetadata(session.metadata)
          return SubagentReview.supervised(brief) ? brief.result : undefined
        }),
        Effect.orElseSucceed(() => undefined),
      )

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const runInBackground = params.background === true
      if (runInBackground && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(
          new Error("Background subagents are turned off here (REDCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=false)"),
        )
      }

      const parent = yield* sessions.get(ctx.sessionID)
      const resumed = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      // The chain that gets prompted is the one that is checked: a resumed task_id must descend from
      // the caller (a sibling or a session from another project never has it as an ancestor), and
      // the depth cap applies to the session the prompt lands in, not to the caller.
      let current = resumed ?? parent
      let depth = resumed ? 0 : 1
      let descendant = resumed === undefined
      while (current.parentID) {
        depth++
        if (current.parentID === ctx.sessionID) descendant = true
        current = yield* sessions.get(current.parentID)
      }
      if (!descendant) {
        return yield* Effect.fail(
          new Error(`task_id ${params.task_id} must reference a subagent session started from this session`),
        )
      }
      if (depth > (cfg.subagent_depth ?? 1)) {
        return yield* Effect.fail(
          new Error(
            `Subagent depth limit reached (${cfg.subagent_depth ?? 1}). Increase "subagent_depth" to allow nested subagents.`,
          ),
        )
      }

      if (!runInBackground) {
        const max = cfg.experimental?.subagent_limits?.concurrent ?? 4
        const count = running.get(ctx.sessionID) ?? 0
        if (count >= max) {
          return yield* Effect.fail(
            new Error(
              `${count} foreground subagent${count === 1 ? " is" : "s are"} already running for this session (limit ${max}). Wait for one to finish before starting another, or fold this work into a running one.`,
            ),
          )
        }
        running.set(ctx.sessionID, count + 1)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            const left = (running.get(ctx.sessionID) ?? 1) - 1
            if (left > 0) return void running.set(ctx.sessionID, left)
            running.delete(ctx.sessionID)
          }),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const childPermission = deriveSubagentSessionPermission({
        parentSessionPermission: parent.permission ?? [],
        subagent: next,
      })
      const childToolDenies = [
        ...(next.permission.some((rule) => rule.permission === "todowrite")
          ? []
          : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
        ...(next.permission.some((rule) => rule.permission === id)
          ? []
          : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
        ...(cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*" as const,
          action: "deny" as const,
        })) ?? []),
      ]
      const permission = [
        ...childPermission,
        ...childToolDenies.filter(
          (deny) =>
            !childPermission.some(
              (rule) =>
                rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
            ),
        ),
      ]

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const userMessage = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: msg.info.parentID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orElseSucceed(() => undefined),
      )
      // The variant the person chose, which an `auto` turn's assistant message does not carry: it
      // records the level that turn applied.
      const asked = userMessage && userMessage.info.role === "user" ? userMessage.info.model.variant : undefined
      const variant = asked ?? msg.info.variant
      const request = latestRequest(ctx.messages, userMessage)
      const resolved = yield* resolveModel({
        model: params.model,
        variant: params.variant,
        agent: next,
        parent: { providerID: msg.info.providerID, modelID: msg.info.modelID },
        parentVariant: variant,
      })

      if (!resumed) {
        const max = cfg.experimental?.subagent_limits?.per_request ?? 12
        const started = (yield* sessions.children(ctx.sessionID)).filter(
          (child) => child.time.created >= request.created,
        ).length
        if (started >= max) {
          return yield* Effect.fail(
            new Error(
              `${started} subagent${started === 1 ? " was" : "s were"} already started for this request (limit ${max}). Finish with the results you have, resume one with its task_id, or do the remaining work directly.`,
            ),
          )
        }
      }

      const writeCapable = ["edit", "bash"].some((item) => Permission.evaluate(item, "*", permission).action !== "deny")
      const review: SubagentReview.Review | undefined = resumed
        ? undefined
        : ctx.extra?.bypassAgentCheck
          ? { verdict: "skipped", issues: [] }
          : yield* reviewBrief({ params, ctx, parent, agent: next, permission, writeCapable, request })

      const nextSession =
        resumed ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          agent: next.name,
          model: {
            id: resolved.model.modelID,
            providerID: resolved.model.providerID,
            ...(resolved.variant ? { variant: resolved.variant } : {}),
          },
          permission,
          metadata: SubagentReview.toMetadata(undefined, {
            brief: params.prompt,
            agent: next.name,
            scope: params.scope ?? [],
            criteria: params.done_criteria ?? [],
            ...(params.return_format ? { returnFormat: params.return_format } : {}),
            writeCapable,
            parentSessionID: ctx.sessionID,
            ...(ctx.callID ? { callID: ctx.callID } : {}),
            ...(review?.evaluationID ? { briefEvaluationID: review.evaluationID } : {}),
            verdict: review?.verdict ?? "skipped",
            issues: review?.issues ?? [],
            created: Date.now(),
          }),
        }))

      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model: { providerID: resolved.model.providerID, modelID: resolved.model.modelID },
        ...(resolved.variant ? { variant: resolved.variant } : {}),
        // Where the model came from: the call (the user asked), the agent's configuration, or the parent.
        modelSource: resolved.source,
        ...(review && review.verdict !== "skipped"
          ? {
              brief: {
                verdict: review.verdict,
                issues: review.issues,
                ...(review.evaluationID ? { evaluationID: review.evaluationID } : {}),
              },
            }
          : {}),
        ...(runInBackground ? { background: true } : {}),
        // Filled in when a foreground result is reviewed; declared here so every result the tool
        // returns has the same metadata shape.
        ...unreviewed,
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      /** One prompt to the child; a subagent that died is a failed task, never an empty result. */
      const send = Effect.fn("TaskTool.send")(function* (
        messageID: MessageID,
        parts: SessionPrompt.PromptInput["parts"],
      ) {
        const result = yield* ops.prompt({
          messageID,
          sessionID: nextSession.id,
          model: {
            modelID: resolved.model.modelID,
            providerID: resolved.model.providerID,
          },
          variant: resolved.variant,
          agent: next.name,
          parts,
        })
        // A subagent that died on an API error, auth failure or a failed tool used to return
        // "", which the parent model reads as "finished, nothing to report" — so it proceeds
        // confidently on work that never happened. Failing the tool is what makes it visible.
        if (result.info.role === "assistant" && result.info.error) {
          const message =
            "message" in result.info.error.data && typeof result.info.error.data.message === "string"
              ? result.info.error.data.message
              : result.info.error.name
          return yield* Effect.fail(new Error(`Subagent failed (task_id: ${nextSession.id}): ${message}`))
        }
        const failed = result.parts.findLast((item) => item.type === "tool" && item.state.status === "error")
        if (failed?.type === "tool" && failed.state.status === "error") {
          return yield* Effect.fail(new Error(`Subagent failed (task_id: ${nextSession.id}): ${failed.state.error}`))
        }
        return result
      })

      /**
       * One prompt and the SubagentStop hook, as in the V2 runtime: a hook that blocks the stop sends
       * its reason back to the child once. A child the stop-loss ended is not sent back.
       */
      const round = Effect.fn("TaskTool.round")(function* (
        messageID: MessageID,
        parts: SessionPrompt.PromptInput["parts"],
      ) {
        const reply = yield* send(messageID, parts)
        if (reply.parts.some(SessionStopLoss.isNotice)) return reply
        const stop = yield* hooks.run({
          event: "SubagentStop",
          matcher: next.name,
          session_id: ctx.sessionID,
          agent_id: nextSession.id,
          agent_type: next.name,
          last_assistant_message: reply.parts.findLast((item) => item.type === "text")?.text ?? "",
        })
        if ((stop.continue && stop.decision !== "deny") || !stop.reason) return reply
        return yield* send(MessageID.ascending(), [{ type: "text", text: stop.reason, synthetic: true }])
      })

      /** Keeps the verdict in the child's metadata, where the result's reader finds it, and hands back the text. */
      const settle = (verdict: SubagentReview.ResultReview, reply: SessionV1.WithParts) =>
        sessions
          .updateMetadata(nextSession.id, (metadata) => {
            const stored = SubagentReview.fromMetadata(metadata)
            return stored ? SubagentReview.toMetadata(metadata, { ...stored, result: verdict }) : metadata
          })
          .pipe(Effect.as(reply.parts.findLast((item) => item.type === "text")?.text ?? ""))

      /** A run of the child; `start` runs the SubagentStart hook, which more context for a running task does not. */
      const runTask = Effect.fn("TaskTool.runTask")(function* (start: boolean) {
        const started = start
          ? yield* hooks.run({
              event: "SubagentStart",
              matcher: next.name,
              session_id: ctx.sessionID,
              agent_id: nextSession.id,
              agent_type: next.name,
            })
          : undefined
        const brief = SubagentReview.instructions({
          scope: params.scope,
          criteria: params.done_criteria,
          returnFormat: params.return_format,
        })
        const resolved = [
          ...(yield* ops.resolvePromptParts(params.prompt)),
          ...(brief ? [{ type: "text" as const, text: brief, synthetic: true }] : []),
          ...(started?.additionalContext
            ? [{ type: "text" as const, text: started.additionalContext, synthetic: true }]
            : []),
        ]
        // The goal is copied, never shared: a child session is blank by design, so the parent's
        // objective rides in as a synthetic part ahead of the task, read fresh each run — the
        // goal may have been dropped or changed since the child was first created.
        const goal = SessionGoal.fromMetadata((yield* sessions.get(ctx.sessionID)).metadata)
        const parts =
          goal?.status === "active"
            ? [{ type: "text" as const, text: SessionGoal.inherit(goal), synthetic: true }, ...resolved]
            : resolved
        const from = MessageID.ascending()
        const first = yield* round(from, parts)
        // The stop-loss ended the child and its last message says why; a review or a repair round
        // would only send it back into what it was stopped for.
        if (first.parts.some(SessionStopLoss.isNotice))
          return first.parts.findLast((item) => item.type === "text")?.text ?? ""
        const child = yield* sessions.get(nextSession.id)
        const supervision = SubagentReview.fromMetadata(child.metadata)
        if (!SubagentReview.supervised(supervision))
          return first.parts.findLast((item) => item.type === "text")?.text ?? ""

        const subject = { sessionID: ctx.sessionID, child, brief: supervision, prompt: params.prompt, from }
        const verdict = yield* reviewResult({ ...subject, replies: [first], repaired: false })
        if (verdict.decision !== "needs_revision") return yield* settle(verdict, first)
        // One repair round a run, in the same child session, and one review after it: the parent
        // reads whatever that second review says.
        const second = yield* round(MessageID.ascending(), [
          { type: "text", text: SubagentReview.repair(verdict), synthetic: true },
        ])
        return yield* settle(yield* reviewResult({ ...subject, replies: [first, second], repaired: true }), second)
      })

      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (
        state: "completed" | "error",
        text: string,
      ) {
        const currentParent = yield* sessions.get(ctx.sessionID)
        const result = state === "completed" ? yield* resultOf(nextSession.id) : undefined
        yield* ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            variant,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: renderOutput({
                  sessionID: nextSession.id,
                  state,
                  summary:
                    state === "completed"
                      ? `Background task completed: ${params.description}`
                      : `Background task failed: ${params.description}`,
                  result,
                  text,
                }),
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })

      const notify = Effect.fn("TaskTool.notifyBackgroundResult")(function* (jobID: string) {
        yield* background.wait({ id: jobID }).pipe(
          Effect.flatMap((result) => {
            if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
            if (result.info?.status === "error") return inject("error", result.info.error ?? "")
            return Effect.void
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      if (yield* background.extend({ id: nextSession.id, run: runTask(false) })) {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: nextSession.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task updated",
            text: BACKGROUND_UPDATED,
          }),
        }
      }

      // A cap per session, not per process: fan-out is bounded by what one conversation can
      // keep track of, and a model that wants a fifth is told to wait or run it inline.
      if (runInBackground) {
        const max = cfg.experimental?.background_subagents_max ?? 4
        const running = (yield* background.list()).filter(
          (job) =>
            job.type === id &&
            job.status === "running" &&
            job.metadata?.["background"] === true &&
            job.metadata?.["parentSessionId"] === ctx.sessionID,
        )
        if (running.length >= max) {
          return yield* Effect.fail(
            new Error(
              `${running.length} background subagent${running.length === 1 ? " is" : "s are"} already running for this session (limit ${max}). Wait for one to report, or run this task in the foreground.`,
            ),
          )
        }
      }

      const info = yield* background.start({
        id: nextSession.id,
        type: id,
        title: params.description,
        metadata,
        onPromote: Effect.all([
          ctx.metadata({
            title: params.description,
            metadata: { ...metadata, background: true, jobId: nextSession.id },
          }),
          notify(nextSession.id),
        ]),
        run: runTask(true).pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id))),
      })

      function backgroundResult() {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: info.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task started",
            review,
            text: BACKGROUND_STARTED,
          }),
        }
      }

      if (runInBackground) {
        yield* notify(info.id)
        return backgroundResult()
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const result = yield* Effect.raceFirst(
              background.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
              background.waitForPromotion(nextSession.id),
            )
            if (result?.metadata?.background === true) return backgroundResult()
            if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            if (result?.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
            const verdict = yield* resultOf(nextSession.id)
            return {
              title: params.description,
              metadata: {
                ...metadata,
                ...(verdict
                  ? { review: { decision: verdict.decision, issues: verdict.issues, repaired: verdict.repaired } }
                  : {}),
              },
              output: renderOutput({
                sessionID: nextSession.id,
                state: "completed",
                review,
                result: verdict,
                text: result?.output ?? "",
              }),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit))
              yield* Effect.all([cancel, background.cancel(nextSession.id)], { discard: true })
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents
        ? [DESCRIPTION, BACKGROUND_DESCRIPTION].join("\n\n")
        : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.scoped, Effect.orDie),
    }
  }),
)

/**
 * The latest thing a person asked in the parent, and when. A continuation the runtime wrote for
 * itself is not a request; the turn's own user message stands in when the history has none.
 */
function latestRequest(messages: SessionV1.WithParts[], fallback: SessionV1.WithParts | undefined) {
  const requests = messages.filter(
    (message) => message.info.role === "user" && message.parts.some((part) => part.type === "text" && !part.synthetic),
  )
  const latest = requests.at(-1) ?? fallback
  return {
    id: latest?.info.id ?? "",
    created: latest?.info.time.created ?? 0,
    texts: (requests.length ? requests.slice(-3) : fallback ? [fallback] : []).map((message) =>
      message.parts.flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : [])).join("\n"),
    ),
  }
}
