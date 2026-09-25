export * as TaskTool from "./task"

import { ToolFailure } from "@reddb-io/redcode-llm"
import { and, eq, gte } from "drizzle-orm"
import { DateTime, Effect, Exit, Layer, Scope, Schema } from "effect"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { Config } from "../config"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { HookV2 } from "../hook"
import { Intelligence } from "../intelligence"
import { ModelV2 } from "../model"
import { ModelChoice } from "../model-choice"
import { PermissionV2 } from "../permission"
import { ProviderV2 } from "../provider"
import { SessionGoal } from "../session/goal"
import { SessionHost } from "../session/host"
import { SessionInput } from "../session/input"
import { SessionMetadata } from "../session/metadata"
import { SessionMessage } from "../session/message"
import { SessionPlan } from "../session/plan"
import { Prompt } from "../session/prompt"
import { ReasoningAuto } from "../session/reasoning-auto"
import { SessionSchema } from "../session/schema"
import { SessionGuardTripTable, SessionTable } from "../session/sql"
import { SessionStopLoss } from "../session/stop-loss"
import { SessionStore } from "../session/store"
import { SubagentReview } from "../session/subagent-review"
import { SessionTodo } from "../session/todo"
import { ModelsTool } from "./models"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "task"

/** Nested subagents a chain may reach below the top-level Session (`subagent_depth`). */
export const MAX_DEPTH = 1
/** Foreground subagents one Session may run at once (`subagent_limits.concurrent`). */
export const MAX_CONCURRENT = 4
/** Subagents one user request may start, resumed ones aside (`subagent_limits.per_request`). */
export const MAX_PER_REQUEST = 12
/** Background subagents one Session may have running (`background_subagents_max`). */
export const MAX_BACKGROUND = 4

/** Tools whose permission tells the brief reviewer what the subagent may do. */
const REVIEWED_PERMISSIONS = ["read", "edit", "bash", "webfetch", "task"]

export const Input = Schema.Struct({
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
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})
export type Input = typeof Input.Type

const ModelSource = Schema.Literals(["explicit", "agent", "parent"])

export const Metadata = Schema.Struct({
  parentSessionId: Schema.String,
  sessionId: Schema.String,
  model: Schema.optional(Schema.Struct({ providerID: Schema.String, modelID: Schema.String })),
  variant: Schema.optional(Schema.String),
  /** Where the model came from: the call (the user asked), the agent's configuration, or the parent. */
  modelSource: ModelSource,
  brief: Schema.optional(
    Schema.Struct({
      verdict: Schema.String,
      issues: Schema.Array(Schema.String),
      evaluationID: Schema.optional(Schema.String),
    }),
  ),
  background: Schema.optional(Schema.Boolean),
  jobId: Schema.optional(Schema.String),
  review: Schema.optional(
    Schema.Struct({
      decision: Schema.String,
      issues: Schema.Array(Schema.String),
      repaired: Schema.Boolean,
    }),
  ),
  /** The stop-loss ended the subagent; the result is its account of why. */
  stopped: Schema.optional(Schema.Boolean),
})
export type Metadata = typeof Metadata.Type

export const Output = Schema.Struct({
  title: Schema.String,
  output: Schema.String,
  metadata: Metadata,
})
export type Output = typeof Output.Type

export const DESCRIPTION = [
  "Launch a new agent to handle complex, multistep tasks autonomously.",
  "",
  "When using the Task tool, you must specify a subagent_type parameter to select which agent type to use.",
  "",
  "When NOT to use the Task tool:",
  "- If you want to read a specific file path, use the Read or Glob tool instead of the Task tool, to find the match more quickly",
  '- If you are searching for a specific class definition like "class Foo", use the Grep tool instead, to find the match more quickly',
  "- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead of the Task tool, to find the match more quickly",
  "- If no available agent is a good fit for the task, use other tools directly",
  "",
  "Writing the brief:",
  "The subagent starts with a blank context: it sees only your brief, never this conversation. Every task call is a brief with five parts:",
  "1. Objective: in the prompt, what to achieve and why, tied to what the user asked.",
  "2. Scope and non-goals: scope lists globs of the files and directories the subagent may change (required in practice for agents that can edit files or run commands); the prompt names what is out of bounds.",
  "3. Done criteria: done_criteria lists observable conditions that mean the work is finished, such as a command that must pass or a question that must be answered.",
  "4. Return format: return_format says what to hand back and in what shape, such as file:line findings, a diff summary, or the commands run with their results.",
  "5. Context handles: in the prompt, the paths, identifiers, error messages, findings and decisions the subagent needs and cannot rediscover.",
  "Say whether you expect code changes or research only, and how the work can be verified.",
  "",
  "Before the subagent starts, the brief is reviewed against the user's request, and in single reasoning only its structure is checked. A brief that needs revision fails the call with the issues and the questions to answer. Revise it and call again; nothing was launched. Only one revision per request is expected: a second rejection lets the task run with a warning.",
  "",
  "Choosing the model:",
  'A subagent runs on its agent\'s configured model, else on yours, with your variant where that model has it. Set model and variant only when the user asks for a particular model or reasoning level, never on your own initiative: with dual reasoning, a model the user did not ask for fails the brief review. Pass model as "providerID/modelID", looked up with the models tool (your own provider first) rather than guessed, and variant as one that tool lists for the model. An unknown model or variant fails the call with the closest matches.',
  "",
  "Reading the result:",
  'The task output can carry a <brief_review verdict="..."> note on the brief, and, when the brief has scope, done_criteria or return_format, a <review decision="..."> block on the result. The result is checked against the brief and the subagent\'s own tool calls: done criteria, claims without evidence (such as tests reported passing with no command that exited 0), changes outside the scope, the requested output, and contradictions with the brief. A result that falls short gets one repair round in the same subagent before the verdict. Decisions mean:',
  "- verified: the result was checked against the brief and its evidence, and no gap was found. Rely on it, citing the evidence it reports.",
  "- needs_revision: gaps remain after the repair round; the block lists them. Verify those points yourself, or re-delegate with a sharper brief, before relying on the result or reporting it.",
  "- inconclusive: the reviewer could not settle it. Check the listed points that matter yourself; this never forces more work.",
  "- unverified: nothing semantic was checked, because reasoning is single or the reviewer was unavailable. Treat the result as unchecked and verify the claims that matter.",
  "The brief verdicts read the same way. A subagent that finished did not necessarily do what was asked: without a verified review, check its claims against its evidence before you rely on them or report them to the user.",
  "A subagent the stop-loss ended returns its account of why it stopped instead of a result; it was not reviewed.",
  "",
  "Usage notes:",
  "1. Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses. Concurrency, nesting depth and the number of subagents per user request are capped, and a call over a cap fails with the reason.",
  "2. Once you have delegated work to an agent, do not duplicate that work yourself. Continue with non-overlapping tasks, or wait for the result. For background tasks, you will be notified automatically when the result is ready.",
  "3. When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result. The output includes a task_id you can reuse later to continue the same subagent session.",
  "4. Each agent invocation starts with a fresh context unless you provide task_id to resume the same subagent session (which continues with its previous messages and tool outputs). A resumed task keeps the brief it was launched with.",
  "5. If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.",
  "",
  "Background mode: background=true launches the subagent asynchronously and returns immediately. Foreground is the default; use it when you need the result before continuing. Use background only for independent work that can run while you continue elsewhere. You will be notified automatically when it finishes.",
].join("\n")

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

/** The `<task>` envelope the parent reads, as legacy renders it. */
export function render(input: {
  readonly sessionID: string
  readonly state: "running" | "completed" | "error"
  readonly summary?: string
  readonly review?: SubagentReview.Review
  readonly result?: SubagentReview.ResultReview
  readonly text: string
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

/**
 * The rules a subagent's Session carries, as legacy's `deriveSubagentSessionPermission`: the parent
 * Session's denies and external-directory rules, so a subagent never gets what its parent was
 * refused, and `todowrite` and `task` denied unless the subagent's own agent names them.
 */
export function derivePermission(input: {
  readonly parent: PermissionV2.Ruleset
  readonly subagent: AgentV2.Info
}): PermissionV2.Ruleset {
  const names = (action: string) => input.subagent.permissions.some((rule) => rule.action === action)
  return [
    ...input.parent.filter((rule) => rule.action === "external_directory" || rule.effect === "deny"),
    ...(names("todowrite") ? [] : [{ action: "todowrite", resource: "*", effect: "deny" as const }]),
    ...(names(name) ? [] : [{ action: name, resource: "*", effect: "deny" as const }]),
  ]
}

/** One settled run of the child: its final text, the tool calls behind it, and how it ended. */
interface Run {
  readonly reply?: SessionMessage.Assistant
  readonly text: string
  readonly parts: ReadonlyArray<SessionStopLoss.Part>
  /** The stop-loss's account, when it ended the run. */
  readonly stopped?: string
}

/** What one task call hands back: the child's text, and how its result was judged. */
interface Outcome {
  readonly text: string
  readonly verdict?: SubagentReview.ResultReview
  readonly stopped?: boolean
}

interface Resolved {
  readonly model?: { readonly providerID: ProviderV2.ID; readonly id: ModelV2.ID }
  readonly variant?: string
  readonly source: typeof ModelSource.Type
}

const fail = (message: string) => new ToolFailure({ message })

/**
 * The V2 `task` tool.
 *
 * It creates a child Session in the parent's Location, admits the brief as the child's prompt
 * through `SessionV2.prompt`, and waits for the child's drain through Session execution: the child
 * runs on its own runner with its own provider turns, never through a loop bridged into this call.
 * The brief is reviewed before launch and the result after, with one repair round in the same child,
 * as legacy does with the shared `SubagentReview` rules. The stop-loss already applies to the
 * child's runner; a child it stopped returns the reason instead of a result.
 */
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const agents = yield* AgentV2.Service
    const permissions = yield* PermissionV2.Service
    const sessions = yield* SessionStore.Service
    const catalog = yield* Catalog.Service
    const hooks = yield* HookV2.Service
    const intelligence = yield* Intelligence.Service
    const goals = yield* SessionGoal.Service
    const plans = yield* SessionPlan.Service
    const todos = yield* SessionTodo.Service
    const events = yield* EventV2.Service
    const config = yield* Config.Service
    const db = (yield* Database.Service).db
    // Background runs outlive the call that started them; they end with this Location.
    const scope = yield* Scope.Scope
    // Foreground subagents per parent, checked and taken in one synchronous step so parallel task
    // calls in one message cannot all slip under the cap.
    const running = new Map<SessionSchema.ID, number>()
    // Background children per parent, while they run.
    const background = new Map<SessionSchema.ID, Set<SessionSchema.ID>>()

    /** The caps in force, under legacy's config keys and defaults, read per call so an edit applies to the next task. */
    const limits = config.entries().pipe(
      Effect.map((entries) => {
        const experimental = Config.latest(entries, "experimental")
        return {
          depth: Config.latest(entries, "subagent_depth") ?? MAX_DEPTH,
          concurrent: experimental?.subagent_limits?.concurrent ?? MAX_CONCURRENT,
          perRequest: experimental?.subagent_limits?.per_request ?? MAX_PER_REQUEST,
          background: experimental?.background_subagents_max ?? MAX_BACKGROUND,
        }
      }),
    )

    /** An S1 evaluation on the parent's behalf. Failing to evaluate is never an error here. */
    const evaluate = (input: Intelligence.EvaluationInput) =>
      intelligence.evaluate(input).pipe(Effect.orElseSucceed(() => undefined))

    const mode = intelligence.read().pipe(
      Effect.orElseSucceed(() => Intelligence.defaults),
      Effect.map((settings) => Intelligence.mode(settings)),
    )

    /** The model a call names, among the connected providers; an unknown one fails with the closest ids. */
    const requireModel = Effect.fn("TaskTool.requireModel")(function* (text: string) {
      const ref = ModelChoice.parse(text)
      const found = yield* catalog.model.get(ProviderV2.ID.make(ref.providerID), ModelV2.ID.make(ref.modelID))
      if (
        found &&
        ModelChoice.runnable({
          providerID: found.providerID,
          id: found.id,
          status: found.status,
          protocol: found.capabilities.protocol,
        })
      )
        return found
      if (found)
        return yield* fail(`${text} is a System One evaluator or a deprecated model; a subagent cannot run on it.`)
      const close = ModelChoice.closest(
        (yield* ModelsTool.entries(catalog)).map((entry) => `${entry.providerID}/${entry.id}`),
        text,
      )
      return yield* fail(
        [
          `Unknown model "${text}": no connected provider serves it.`,
          ...(close.length ? [`Close matches: ${close.join(", ")}.`] : []),
          'Pass it as "providerID/modelID"; the models tool searches the available models.',
        ].join(" "),
      )
    })

    /**
     * The model a subagent runs on: the one the call names, else its agent's, else the parent's. A
     * variant the call names must exist on that model; an inherited one is dropped where it does not.
     */
    const resolveModel = Effect.fn("TaskTool.resolveModel")(function* (input: {
      readonly model?: string
      readonly variant?: string
      readonly agent: AgentV2.Info
      readonly parent?: { readonly providerID: ProviderV2.ID; readonly id: ModelV2.ID }
      readonly parentVariant?: string
    }) {
      const explicit = input.model === undefined ? undefined : yield* requireModel(input.model)
      const source = explicit ? "explicit" : input.agent.model ? "agent" : "parent"
      const model = explicit
        ? { providerID: explicit.providerID, id: explicit.id }
        : input.agent.model
          ? { providerID: input.agent.model.providerID, id: input.agent.model.id }
          : input.parent
      // The parent's variant was chosen for the parent's model, so on that model it needs no check.
      if (input.variant === undefined && source === "parent")
        return { model, variant: input.parentVariant, source } satisfies Resolved
      const info = explicit ?? (model ? yield* catalog.model.get(model.providerID, model.id) : undefined)
      const choices = ReasoningAuto.options(info?.variants.map((variant) => variant.id) ?? [])
      if (input.variant !== undefined && !choices.includes(input.variant)) {
        const ref = model ? `${model.providerID}/${model.id}` : "The subagent's model"
        return yield* fail(
          choices.length
            ? `Variant "${input.variant}" is not available for ${ref}. Available: ${choices.join(", ")}.`
            : `${ref} has no variants. Leave variant out.`,
        )
      }
      const inherited = source === "agent" ? input.agent.model?.variant : input.parentVariant
      const variant = input.variant ?? (inherited !== undefined && choices.includes(inherited) ? inherited : undefined)
      return { model, variant, source } satisfies Resolved
    })

    /**
     * Whether the brief is good enough to launch on. Structure is checked in every mode; dual
     * reasoning also asks S1 against the user's request. A rejection fails the tool so the parent
     * revises; one revision per request and agent type, after which the task proceeds with a warning.
     * S1 that is unavailable or undecided never approves silently: the task proceeds, labelled.
     */
    const reviewBrief = Effect.fn("TaskTool.reviewBrief")(function* (input: {
      readonly params: Input
      readonly parent: SessionSchema.Info
      readonly agent: AgentV2.Info
      readonly rules: PermissionV2.Ruleset
      readonly writeCapable: boolean
      readonly request: Request
    }) {
      const findings = SubagentReview.briefStructure({
        prompt: input.params.prompt,
        scope: input.params.scope,
        doneCriteria: input.params.done_criteria,
        returnFormat: input.params.return_format,
        writeCapable: input.writeCapable,
      })
      const blocking = findings.filter((finding) => finding.blocking)
      if (blocking.length)
        return yield* fail(
          SubagentReview.rejection(input.agent.id, {
            verdict: "needs_revision",
            issues: blocking.map((finding) => finding.id),
            findings: blocking,
          }),
        )
      if ((yield* mode) === "single")
        return {
          verdict: "unverified",
          issues: findings.map((finding) => finding.id),
          findings,
        } satisfies SubagentReview.Review

      const subjectID = `${input.request.id}:${input.agent.id}`
      const rejected = yield* intelligence
        .history(input.parent.id, { operation: "subagent_brief", subjectID, decision: "needs_revision" })
        .pipe(Effect.orElseSucceed(() => []))
      const goal = yield* goals.get(input.parent.id).pipe(Effect.orElseSucceed(() => undefined))
      const plan = (yield* plans.list(input.parent.id).pipe(Effect.orElseSucceed(() => [])))
        .filter((item) => item.status === "approved")
        .toSorted((a, b) => b.created - a.created)[0]
      const record = yield* evaluate({
        sessionID: input.parent.id,
        operation: "subagent_brief",
        subjectID,
        attempt: rejected.length,
        sources: {
          requests: Intelligence.evidence(input.request.texts, { reference: input.parent.id, limit: 16_000 }),
          goal: goal?.status === "active" ? { objective: goal.objective } : undefined,
          todos: (yield* todos.get(input.parent.id)).map((todo) => ({ content: todo.content, status: todo.status })),
          plan: plan
            ? {
                path: plan.path,
                tasks: plan.tasks?.map((task) => ({ content: task.content, criterion: task.criterion })),
              }
            : undefined,
          agent: {
            name: input.agent.id,
            description: input.agent.description,
            write_capable: input.writeCapable,
            permissions: Object.fromEntries(
              REVIEWED_PERMISSIONS.map((item) => [item, PermissionV2.evaluate(item, "*", input.rules).effect]),
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
        } satisfies SubagentReview.Review
      if (record.decision === "accepted")
        return { verdict: "verified", issues: [], evaluationID: record.id } satisfies SubagentReview.Review
      if (record.decision === "inconclusive")
        return {
          verdict: "inconclusive",
          issues: record.issues,
          evaluationID: record.id,
        } satisfies SubagentReview.Review
      if (!rejected.length)
        return yield* fail(
          SubagentReview.rejection(input.agent.id, {
            verdict: "needs_revision",
            issues: record.issues,
            evaluationID: record.id,
          }),
        )
      return {
        verdict: "needs_revision",
        issues: record.issues,
        evaluationID: record.id,
      } satisfies SubagentReview.Review
    })

    /**
     * Whether the subagent's result holds up against its brief. Mechanical checks run in every mode;
     * dual reasoning then asks S1 with the brief and a bounded digest of the subagent's tool calls,
     * unless a blocking finding already settles it. S1 that fails leaves the result unverified.
     */
    const reviewResult = Effect.fn("TaskTool.reviewResult")(function* (input: {
      readonly parentID: SessionSchema.ID
      readonly child: SessionSchema.Info
      readonly brief: SubagentReview.Brief
      readonly prompt: string
      readonly run: Run
      readonly repaired: boolean
    }) {
      const findings = SubagentReview.resultChecks(
        { text: input.run.text, parts: input.run.parts },
        {
          criteria: input.brief.criteria,
          scope: input.brief.scope,
          changesRequested: input.brief.writeCapable,
          directory: input.child.location.directory,
        },
      )
      const single = (yield* mode) === "single"
      if (single || findings.some((finding) => finding.blocking))
        return SubagentReview.judge({ findings, single, repaired: input.repaired })
      const evaluation = yield* evaluate({
        sessionID: input.parentID,
        operation: "subagent_result",
        subjectID: input.child.id,
        candidateID: input.run.reply?.id,
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
          tool_calls: Intelligence.evidence(
            SubagentReview.digest(input.run.parts, { directory: input.child.location.directory }),
            { reference: `${input.child.id}/tool-calls`, limit: 16_000 },
          ),
        },
        candidate: Intelligence.evidence(input.run.text, { reference: input.run.reply?.id, limit: 12_000 }),
        questions: SubagentReview.resultQuestions,
      })
      return SubagentReview.judge({ findings, evaluation, single: false, repaired: input.repaired })
    })

    /** What the child did since `from`, the first prompt of this task call. */
    const collect = Effect.fn("TaskTool.collect")(function* (
      sessionID: SessionSchema.ID,
      from: SessionMessage.ID,
      started: number,
    ) {
      const messages = yield* sessions.context(sessionID).pipe(Effect.orElseSucceed(() => []))
      // A compaction may have folded the prompt away; then all the history is this run's.
      const window = messages.slice(messages.findIndex((message) => message.id === from) + 1)
      const replies = window.filter((message): message is SessionMessage.Assistant => message.type === "assistant")
      const reply = replies.at(-1)
      const trip = yield* db
        .select({ id: SessionGuardTripTable.id })
        .from(SessionGuardTripTable)
        .where(
          and(
            eq(SessionGuardTripTable.session_id, sessionID),
            eq(SessionGuardTripTable.guard, "stop_loss"),
            eq(SessionGuardTripTable.action, "stop"),
            gte(SessionGuardTripTable.time_created, started),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      const notice = window.findLast((message) => message.type === "synthetic")
      return {
        reply,
        text: reply?.content.findLast((item): item is SessionMessage.AssistantText => item.type === "text")?.text ?? "",
        parts: replies.flatMap(SessionStopLoss.parts),
        ...(trip && notice?.type === "synthetic" ? { stopped: notice.text } : {}),
      } satisfies Run
    })

    /**
     * Admits one prompt to the child and waits for its drain. A drain that was already settling when
     * the prompt landed can leave it pending, so the child is resumed until it has taken it.
     */
    const send = Effect.fn("TaskTool.send")(function* (host: SessionHost.Host, child: SessionSchema.ID, text: string) {
      const admitted = yield* host
        .prompt({ sessionID: child, prompt: { text }, resume: false })
        .pipe(
          Effect.mapError((error) =>
            fail(
              error._tag === "Hook.BlockedError"
                ? `Subagent prompt blocked (task_id: ${child}): ${error.reason}`
                : `Subagent could not be prompted (task_id: ${child}): ${error._tag}`,
            ),
          ),
        )
      yield* drain(host, child, 3)
      return admitted.id
    })

    const drain = (
      host: SessionHost.Host,
      child: SessionSchema.ID,
      attempts: number,
    ): Effect.Effect<void, ToolFailure> =>
      host.resume(child).pipe(
        Effect.mapError((error) => fail(`Subagent failed (task_id: ${child}): ${error.message || "its run failed"}`)),
        Effect.andThen(SessionInput.hasPending(db, child, "steer")),
        Effect.flatMap((pending) => (pending && attempts > 1 ? drain(host, child, attempts - 1) : Effect.void)),
      )

    /** A run that died is a failed task, never an empty result the parent reads as done. */
    const requireSettled = Effect.fnUntraced(function* (child: SessionSchema.ID, run: Run) {
      if (run.reply?.error) return yield* fail(`Subagent failed (task_id: ${child}): ${run.reply.error.message}`)
      const failed = run.reply?.content.findLast((item) => item.type === "tool" && item.state.status === "error")
      if (failed?.type === "tool" && failed.state.status === "error")
        return yield* fail(`Subagent failed (task_id: ${child}): ${failed.state.error.message}`)
    })

    /**
     * One round: prompt, drain, and the SubagentStop hook. A hook that blocks the stop sends its
     * reason back to the child once, as Claude's SubagentStop does.
     */
    const round = Effect.fn("TaskTool.round")(function* (input: {
      readonly host: SessionHost.Host
      readonly parentID: SessionSchema.ID
      readonly child: SessionSchema.ID
      readonly agent: AgentV2.ID
      readonly text: string
      readonly from?: SessionMessage.ID
    }) {
      const started = Date.now()
      const admitted = yield* send(input.host, input.child, input.text)
      const from = input.from ?? admitted
      const first = yield* collect(input.child, from, started)
      if (first.stopped) return { from, run: first }
      yield* requireSettled(input.child, first)
      const stop = yield* hooks.run({
        event: "SubagentStop",
        matcher: input.agent,
        session_id: input.parentID,
        agent_id: input.child,
        agent_type: input.agent,
        last_assistant_message: first.text,
      })
      if ((stop.continue && stop.decision !== "deny") || !stop.reason) return { from, run: first }
      yield* send(input.host, input.child, stop.reason)
      const second = yield* collect(input.child, from, started)
      if (!second.stopped) yield* requireSettled(input.child, second)
      return { from, run: second }
    })

    /** The child's work for one task call, reviewed against its brief when it has one. */
    const work = Effect.fn("TaskTool.work")(function* (input: {
      readonly host: SessionHost.Host
      readonly parent: SessionSchema.Info
      readonly child: SessionSchema.Info
      readonly agent: AgentV2.ID
      readonly prompt: string
      readonly text: string
    }): Effect.fn.Return<Outcome, ToolFailure> {
      const first = yield* round({
        host: input.host,
        parentID: input.parent.id,
        child: input.child.id,
        agent: input.agent,
        text: input.text,
      })
      // The stop-loss ended the child and its last message says why; a review or a repair round
      // would only send it back into what it was stopped for.
      if (first.run.stopped) return { text: first.run.stopped, stopped: true }
      const brief = SubagentReview.fromMetadata(yield* sessions.metadata(input.child.id))
      if (!SubagentReview.supervised(brief)) return { text: first.run.text }
      const subject = { parentID: input.parent.id, child: input.child, brief, prompt: input.prompt }
      const verdict = yield* reviewResult({ ...subject, run: first.run, repaired: false })
      if (verdict.decision !== "needs_revision") return yield* settle(input.child.id, verdict, first.run.text)
      // One repair round a run, in the same child Session, and one review after it: the parent reads
      // whatever that second review says.
      const second = yield* round({
        host: input.host,
        parentID: input.parent.id,
        child: input.child.id,
        agent: input.agent,
        text: SubagentReview.repair(verdict),
        from: first.from,
      })
      if (second.run.stopped) return { text: second.run.stopped, stopped: true }
      const revised = yield* reviewResult({ ...subject, run: second.run, repaired: true })
      return yield* settle(input.child.id, revised, second.run.text)
    })

    /**
     * Keeps the verdict in the child's metadata, as legacy does, where the sidebar and a later
     * reader of the result find it without the parent's task part.
     */
    const settle = (child: SessionSchema.ID, verdict: SubagentReview.ResultReview, text: string) =>
      SessionMetadata.update(db, events, child, (metadata) => {
        const stored = SubagentReview.fromMetadata(metadata)
        return stored ? SubagentReview.toMetadata(metadata, { ...stored, result: verdict }) : metadata
      }).pipe(Effect.as({ text, verdict } satisfies Outcome))

    /** Foreground calls take a slot of their parent's before anything is created, and give it back. */
    const run = (params: Input, context: Tool.Context) =>
      params.background === true
        ? launch(params, context)
        : Effect.flatMap(limits, (caps) => {
            const count = running.get(context.sessionID) ?? 0
            if (count >= caps.concurrent)
              return Effect.fail(
                fail(
                  `${count} foreground subagent${count === 1 ? " is" : "s are"} already running for this session (limit ${caps.concurrent}). Wait for one to finish before starting another, or fold this work into a running one.`,
                ),
              )
            running.set(context.sessionID, count + 1)
            return launch(params, context).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  const left = (running.get(context.sessionID) ?? 1) - 1
                  if (left > 0) return void running.set(context.sessionID, left)
                  running.delete(context.sessionID)
                }),
              ),
            )
          })

    const launch = Effect.fn("TaskTool.launch")(function* (params: Input, context: Tool.Context) {
      const host = SessionHost.get()
      if (!host) return yield* fail("Subagents need a runtime that runs Sessions, and none runs here.")
      const inBackground = params.background === true
      if (inBackground && !backgroundEnabled())
        return yield* fail("Background subagents are turned off here (REDCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=false)")
      const parent = yield* sessions.get(context.sessionID)
      if (!parent) return yield* fail(`Session ${context.sessionID} was not found.`)
      const caps = yield* limits
      // An unknown task_id starts a fresh task, as in legacy.
      const resumed =
        params.task_id?.startsWith("ses") === true
          ? yield* sessions.get(SessionSchema.ID.make(params.task_id))
          : undefined
      yield* requireLineage(parent, resumed, params.task_id, caps.depth)

      yield* permissions
        .assert({
          action: name,
          resources: [params.subagent_type],
          save: ["*"],
          metadata: { description: params.description, subagent_type: params.subagent_type },
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
        })
        .pipe(
          Effect.mapError((error) =>
            fail(
              error._tag === "PermissionV2.CorrectedError"
                ? `Starting the subagent was refused: ${error.feedback}`
                : `Starting a ${params.subagent_type} subagent is not allowed here.`,
            ),
          ),
        )

      const agent = yield* agents.get(AgentV2.ID.make(params.subagent_type))
      if (!agent) return yield* fail(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const rules = derivePermission({ parent: yield* sessions.permission(parent.id), subagent: agent })
      const effective = [...agent.permissions, ...rules]
      const writeCapable = ["edit", "bash"].some(
        (item) => PermissionV2.evaluate(item, "*", effective).effect !== "deny",
      )
      const history = yield* sessions.context(parent.id).pipe(Effect.orElseSucceed(() => []))
      const request = latestRequest(history)
      const current = yield* sessions.message(context.assistantMessageID)
      const turn = current?.message.type === "assistant" ? current.message.model : undefined
      const chosen = parent.model?.variant === "default" ? undefined : parent.model?.variant
      const resolved = yield* resolveModel({
        model: params.model,
        variant: params.variant,
        agent,
        parent: turn ?? parent.model,
        parentVariant: chosen ?? turn?.variant,
      })

      if (!resumed) {
        const started = yield* db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(and(eq(SessionTable.parent_id, parent.id), gte(SessionTable.time_created, request.created)))
          .all()
          .pipe(Effect.orDie)
        if (started.length >= caps.perRequest)
          return yield* fail(
            `${started.length} subagent${started.length === 1 ? " was" : "s were"} already started for this request (limit ${caps.perRequest}). Finish with the results you have, resume one with its task_id, or do the remaining work directly.`,
          )
      }

      const review: SubagentReview.Review | undefined = resumed
        ? undefined
        : yield* reviewBrief({ params, parent, agent, rules: effective, writeCapable, request })

      const child =
        resumed ??
        (yield* host.create({
          parentID: parent.id,
          // A subagent works where its parent works.
          location: parent.location,
          title: `${params.description} (@${agent.id} subagent)`,
          agent: agent.id,
          model: resolved.model
            ? {
                id: resolved.model.id,
                providerID: resolved.model.providerID,
                ...(resolved.variant ? { variant: ModelV2.VariantID.make(resolved.variant) } : {}),
              }
            : undefined,
          permission: rules,
          metadata: SubagentReview.toMetadata(undefined, {
            brief: params.prompt,
            agent: agent.id,
            scope: params.scope ?? [],
            criteria: params.done_criteria ?? [],
            ...(params.return_format ? { returnFormat: params.return_format } : {}),
            writeCapable,
            parentSessionID: parent.id,
            callID: context.toolCallID,
            ...(review?.evaluationID ? { briefEvaluationID: review.evaluationID } : {}),
            verdict: review?.verdict ?? "skipped",
            issues: review?.issues ?? [],
            created: Date.now(),
          }),
        }))

      const metadata: Metadata = {
        parentSessionId: parent.id,
        sessionId: child.id,
        ...(resolved.model ? { model: { providerID: resolved.model.providerID, modelID: resolved.model.id } } : {}),
        ...(resolved.variant ? { variant: resolved.variant } : {}),
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
        ...(inBackground ? { background: true } : {}),
      }

      // More context for a task still running in the background: it reads it at its next boundary.
      if (background.get(parent.id)?.has(child.id)) {
        yield* host
          .prompt({ sessionID: child.id, prompt: { text: params.prompt } })
          .pipe(Effect.mapError(() => fail(`Could not reach the running task ${child.id}.`)))
        return {
          title: params.description,
          metadata: { ...metadata, background: true, jobId: child.id },
          output: render({
            sessionID: child.id,
            state: "running",
            summary: "Background task updated",
            text: BACKGROUND_UPDATED,
          }),
        } satisfies Output
      }

      const start = yield* hooks.run({
        event: "SubagentStart",
        matcher: agent.id,
        session_id: parent.id,
        agent_id: child.id,
        agent_type: agent.id,
      })
      const brief = SubagentReview.instructions({
        scope: params.scope,
        criteria: params.done_criteria,
        returnFormat: params.return_format,
      })
      // The goal is copied, never shared: a child Session is blank by design, so the parent's
      // objective rides in ahead of the task, read fresh each run.
      const goal = yield* goals.get(parent.id).pipe(Effect.orElseSucceed(() => undefined))
      const text = [
        ...(goal?.status === "active" ? [inherit(goal.objective)] : []),
        params.prompt,
        ...(brief ? [brief] : []),
        ...(start.additionalContext ? [start.additionalContext] : []),
      ].join("\n\n")
      const task = work({ host, parent, child, agent: agent.id, prompt: params.prompt, text })

      if (inBackground) {
        const siblings = background.get(parent.id) ?? new Set<SessionSchema.ID>()
        if (siblings.size >= caps.background)
          return yield* fail(
            `${siblings.size} background subagent${siblings.size === 1 ? " is" : "s are"} already running for this session (limit ${caps.background}). Wait for one to report, or run this task in the foreground.`,
          )
        siblings.add(child.id)
        background.set(parent.id, siblings)
        const summary = (state: string) => `Background task ${state}: ${params.description}`
        yield* task.pipe(
          Effect.map((outcome): Parameters<typeof render>[0] => ({
            sessionID: child.id,
            state: "completed",
            summary: summary("completed"),
            ...(outcome.verdict ? { result: outcome.verdict } : {}),
            text: outcome.text,
          })),
          Effect.catch((error) =>
            Effect.succeed<Parameters<typeof render>[0]>({
              sessionID: child.id,
              state: "error",
              summary: summary("failed"),
              text: error.message,
            }),
          ),
          Effect.exit,
          Effect.flatMap((exit) =>
            report(
              host,
              parent.id,
              Exit.isSuccess(exit)
                ? exit.value
                : {
                    sessionID: child.id,
                    state: "error",
                    summary: summary("failed"),
                    text: "The task stopped before it finished.",
                  },
            ),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              siblings.delete(child.id)
              if (siblings.size === 0) background.delete(parent.id)
            }),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        )
        return {
          title: params.description,
          metadata: { ...metadata, background: true, jobId: child.id },
          output: render({
            sessionID: child.id,
            state: "running",
            summary: "Background task started",
            review,
            text: BACKGROUND_STARTED,
          }),
        } satisfies Output
      }

      // Stopping the parent's call stops the child it is waiting on.
      const result = yield* task.pipe(Effect.onInterrupt(() => host.interrupt(child.id)))
      return {
        title: params.description,
        metadata: {
          ...metadata,
          ...(result.verdict
            ? {
                review: {
                  decision: result.verdict.decision,
                  issues: result.verdict.issues,
                  repaired: result.verdict.repaired,
                },
              }
            : {}),
          ...(result.stopped ? { stopped: true } : {}),
        },
        output: render({
          sessionID: child.id,
          state: "completed",
          ...(result.stopped ? { summary: "Stopped by the stop-loss before finishing" } : {}),
          review,
          result: result.verdict,
          text: result.text,
        }),
      } satisfies Output
    })

    /**
     * The chain that gets prompted is the one that is checked: a resumed task_id must descend from
     * the caller, and the depth cap applies to the Session the prompt lands in.
     */
    const requireLineage = Effect.fn("TaskTool.requireLineage")(function* (
      parent: SessionSchema.Info,
      resumed: SessionSchema.Info | undefined,
      taskID: string | undefined,
      max: number,
    ) {
      const chain = yield* ancestors(resumed ?? parent)
      if (resumed && !chain.includes(parent.id))
        return yield* fail(`task_id ${taskID} must reference a subagent session started from this session`)
      const depth = chain.length + (resumed ? 0 : 1)
      if (depth > max)
        return yield* fail(`Subagent depth limit reached (${max}). Increase "subagent_depth" to allow nested subagents.`)
    })

    const ancestors = (session: SessionSchema.Info): Effect.Effect<SessionSchema.ID[]> =>
      session.parentID
        ? sessions
            .get(session.parentID)
            .pipe(
              Effect.flatMap((next) =>
                next
                  ? ancestors(next).pipe(Effect.map((rest) => [next.id, ...rest]))
                  : Effect.succeed([session.parentID!]),
              ),
            )
        : Effect.succeed([])

    /** Hands a finished background task to its parent as a queued input, and wakes the parent. */
    const report = (host: SessionHost.Host, parentID: SessionSchema.ID, input: Parameters<typeof render>[0]) =>
      SessionInput.admit(db, events, {
        id: SessionMessage.ID.create(),
        sessionID: parentID,
        prompt: Prompt.make({ text: render(input) }),
        delivery: "queue",
      }).pipe(Effect.andThen(host.wake(parentID)), Effect.ignore)

    yield* tools
      .register({
        [name]: Tool.make({
          description: DESCRIPTION,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
          execute: run,
        }),
      })
      .pipe(Effect.orDie)
  }),
)

interface Request {
  readonly id: string
  readonly created: number
  readonly texts: ReadonlyArray<string>
}

/** The latest thing a person asked in the parent, and when, with the two before it. */
function latestRequest(messages: ReadonlyArray<SessionMessage.Message>): Request {
  const requests = messages.filter((message): message is SessionMessage.User => message.type === "user")
  const latest = requests.at(-1)
  return {
    id: latest?.id ?? "",
    created: latest ? DateTime.toEpochMillis(latest.time.created) : 0,
    texts: requests.slice(-3).map((message) => message.text),
  }
}

function inherit(objective: string) {
  return [
    "<goal>",
    "This task is one part of a larger goal the calling agent is pursuing. Do the task you were given so that it fits the goal; do not attempt the rest of the goal, and do not redefine the task to something smaller.",
    "",
    `Objective: ${objective}`,
    "",
    "Report what you did with evidence — file contents, command output, test results — and say plainly what you could not do.",
    "</goal>",
  ].join("\n")
}

function backgroundEnabled() {
  const value = process.env["REDCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS"]?.toLowerCase()
  return value !== "false" && value !== "0"
}

export const node = makeLocationNode({
  name: "tool/task",
  layer,
  deps: [
    ToolRegistry.toolsNode,
    AgentV2.node,
    PermissionV2.node,
    SessionStore.node,
    Catalog.node,
    Config.node,
    HookV2.node,
    Intelligence.node,
    SessionGoal.node,
    SessionPlan.node,
    SessionTodo.node,
    EventV2.node,
    Database.node,
  ],
})
