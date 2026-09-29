export * as SubagentTool from "./subagent.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { Entry } from "@opencode/schema/config"
import { SubagentReview } from "@opencode/schema/subagent-review"
import { DateTime, Effect, Exit, Predicate, Schema, Scope, Semaphore } from "effect"
import { Agent } from "../../agent.js"
import { HookRuntime } from "../../hook.js"
import { Config } from "../../config.js"
import { Intelligence } from "../../intelligence.js"
import { IntelligenceEvaluation } from "../../intelligence/evaluation.js"
import { IntelligenceSubagentReview } from "../../intelligence/subagent-review.js"
import { Job } from "../../job.js"
import { Model } from "../../model.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionMessage } from "../../session/message.js"
import { SessionSchema } from "../../session/schema.js"
import { SessionStopLoss } from "../../session/stop-loss.js"
import { SubagentCompletion } from "../../session/subagent-completion.js"
import { SubagentJob } from "../../session/subagent-job.js"

export const name = "subagent"

const backgroundResult = (sessionID: SessionSchema.ID, note?: string) => ({
  sessionID,
  status: "running" as const,
  output: [
    `The subagent is working in the background (sessionID: ${sessionID}). You will be notified automatically when it finishes.`,
    "DO NOT sleep, poll for progress, ask the subagent for status, or duplicate this subagent's work; avoid working with the same files or topics it is using.",
    "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
    ...(note ? [note] : []),
  ].join("\n"),
})

export const Input = Schema.Struct({
  agent: Schema.String.annotate({
    description:
      "The type of specialized agent to use for this task. If the user asks for a subagent by a name that is not one of the available subagents, they most likely mean a model: pick a suitable agent and pass the name through the model parameter instead.",
  }),
  description: Schema.String.annotate({ description: "A short 3-5 word label for the task, displayed to the user" }),
  prompt: Schema.String.annotate({ description: "The task for the subagent to perform" }),
  scope: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description:
      "Globs, relative to the project root, of the files and directories the subagent may change, e.g. packages/core/src/session/**. Expected for agents that can edit files or run commands; name the non-goals in the prompt.",
  }),
  done_criteria: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description:
      "Observable conditions that mean the task is done, one per entry, e.g. the session tests pass, or every caller of foo() is listed.",
  }),
  return_format: Schema.optionalKey(Schema.String).annotate({
    description:
      "What the subagent must hand back and in what shape, e.g. a list of file:line findings with one line of explanation each.",
  }),
  model: Schema.optionalKey(Schema.String).annotate({
    description:
      'NEVER set this unless the user explicitly asks for a particular model or variant. The value is written as "providerID/modelID", or "providerID/modelID#variant" to include a variant. Do not guess the ID: look the model up with the models tool, filtering to your own provider first.',
  }),
  sessionID: Schema.optionalKey(SessionSchema.ID).annotate({
    description:
      "Continue a specific previous subagent conversation by passing its sessionID. Calls without a sessionID start a new conversation.",
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the subagent in the background and return immediately. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress.",
  }),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
  status: Schema.Literals(["completed", "running"]),
  output: Schema.String,
})
export const description = [
  "Spawns an agent in a child session to work on the specified task.",
  "The output includes a sessionID you can pass back later to continue that specific conversation with the subagent.",
  "New child sessions start with fresh context, so include all relevant context and instructions when you don't pass a sessionID.",
  "Foreground (default) runs the subagent to completion and returns its final response.",
  "Background mode (background=true) launches it asynchronously and returns immediately; you are notified when it finishes.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "",
  "Writing the brief: the prompt holds the objective, the context the subagent cannot rediscover and the non-goals; scope lists globs of what it may change; done_criteria lists observable conditions that mean the work is finished; return_format says what to hand back and in what shape.",
  "With dual reasoning the brief is reviewed before the subagent starts. A brief that needs revision fails the call with the issues and the questions to answer; nothing was launched, so revise it and call again. A second rejection for the same request lets the subagent start with a warning.",
  "",
  'Reading the result: when the brief has scope, done_criteria or return_format, the result carries a <review decision="..."> block from checking it against the brief and the subagent\'s own tool calls; a result that falls short gets one repair round first.',
  "- verified: no gap was found. Rely on it, citing the evidence it reports.",
  "- needs_revision: gaps remain; verify the listed points yourself or re-delegate with a sharper brief before relying on it.",
  "- inconclusive: the review could not settle it; check the points that matter yourself.",
  "- unverified: only mechanical checks ran, or the reviewer was unavailable. Treat the result as unchecked.",
  "A subagent that finished did not necessarily do what was asked: without a verified review, check its claims against its evidence before you rely on them or report them.",
  "",
  "Nesting depth, subagents in flight per session and new subagents per user request are capped; a call over a cap fails with the reason and what to do instead.",
].join("\n")

/** The caps in force when a config sets none. */
export const LIMITS = { depth: 1, concurrent: 4, perRequest: 12, background: 4, subtasks: 4 }

/** The caps in force, read per call so a config edit applies to the next subagent. */
export function limits(entries: readonly Entry[]) {
  const fanOut = Config.latestExperimental(entries, "subagent_limits")
  return {
    depth: Config.latestExperimental(entries, "subagent_depth") ?? LIMITS.depth,
    concurrent: fanOut?.concurrent ?? LIMITS.concurrent,
    perRequest: fanOut?.per_request ?? LIMITS.perRequest,
    background: Config.latestExperimental(entries, "background_subagents_max") ?? LIMITS.background,
    subtasks: Config.latestExperimental(entries, "subtask_concurrency") ?? LIMITS.subtasks,
  }
}

/**
 * Takes one of `key`'s slots for `token`, checked and taken in one synchronous step so parallel
 * calls in one message cannot all slip under the cap. Returns how many slots were already taken
 * when the cap refuses it, undefined when the slot was taken.
 */
export function admit(slots: Map<string, Set<string>>, key: string, token: string, limit: number) {
  const taken = slots.get(key) ?? new Set<string>()
  if (taken.size >= limit) return taken.size
  slots.set(key, taken.add(token))
  return undefined
}

export function release(slots: Map<string, Set<string>>, key: string, token: string) {
  const taken = slots.get(key)
  if (!taken) return
  taken.delete(token)
  if (taken.size === 0) slots.delete(key)
}

/** The tool error for a call over a cap: what the cap is, and what the model can do instead. */
export function refusal(cap: "concurrent" | "background" | "per_request", count: number, limit: number) {
  const running = count === 1 ? " is" : "s are"
  if (cap === "concurrent")
    return `${count} foreground subagent${running} already running for this session (limit ${limit}, experimental.subagent_limits.concurrent). Wait for one to finish before starting another, or fold this work into a running one.`
  if (cap === "background")
    return `${count} background subagent${running} already running for this session (limit ${limit}, experimental.background_subagents_max). Wait for one to report, or run this task in the foreground.`
  return `${count} subagent${count === 1 ? " was" : "s were"} already started for this request (limit ${limit}, experimental.subagent_limits.per_request). Finish with the results you have, continue one with its sessionID, or do the remaining work directly.`
}

export const Plugin = {
  id: "opencode.tool.subagent",
  effect: Effect.fn("SubagentTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const hooks = yield* HookRuntime.Service
    const intelligence = yield* Intelligence.Service
    const permission = yield* Permission.Service
    const models = yield* Model.Service
    const scope = yield* Scope.Scope
    const subagents = yield* SubagentJob.make
    // Slots per parent session, while the subagents holding them run.
    const foreground = new Map<string, Set<string>>()
    const background = new Map<string, Set<string>>()
    const running = new Map<string, Semaphore.Semaphore>()

    const single = intelligence.read().pipe(
      Effect.orElseSucceed(() => IntelligenceEvaluation.defaults),
      Effect.map((settings) => IntelligenceEvaluation.mode(settings) === "single"),
    )

    const resolveModel = Effect.fn("SubagentTool.resolveModel")(function* (input: string) {
      const ref = yield* Effect.try({
        try: () => Model.Ref.parse(input),
        catch: () =>
          new ToolFailure({
            message: `Invalid model "${input}". Use "providerID/modelID" or "providerID/modelID#variant".`,
          }),
      })
      const model = (yield* models.available()).find(
        (model) => model.providerID === ref.providerID && model.id === ref.id,
      )
      if (model === undefined)
        return yield* new ToolFailure({
          message: `Model "${ref.providerID}/${ref.id}" is not available. Use the models tool to see what is available.`,
        })
      if (ref.variant !== undefined && !model.variants.some((variant) => variant.id === ref.variant))
        return yield* new ToolFailure({
          message:
            model.variants.length === 0
              ? `Model "${ref.providerID}/${ref.id}" has no variants. Omit the variant.`
              : `Variant "${ref.variant}" is not available for "${ref.providerID}/${ref.id}". Available: ${model.variants.map((variant) => variant.id).join(", ")}.`,
        })
      return ref
    })

    /**
     * The brief's review before launch. The structure is checked in every mode and an empty prompt
     * never launches; dual reasoning also asks S1, once per request and agent before it lets a
     * rejected brief through with a warning. S1 that is unavailable never approves silently.
     */
    const reviewBrief = Effect.fn("SubagentTool.reviewBrief")(function* (input: {
      readonly params: typeof Input.Type
      readonly parentID: SessionSchema.ID
      readonly agent: { readonly id: string; readonly description?: string }
      readonly writeCapable: boolean
      readonly request: Request
    }) {
      const brief = {
        prompt: input.params.prompt,
        scope: input.params.scope,
        doneCriteria: input.params.done_criteria,
        returnFormat: input.params.return_format,
        writeCapable: input.writeCapable,
      }
      const findings = IntelligenceSubagentReview.briefStructure(brief)
      const skip = (yield* single) || findings.some((finding) => finding.blocking)
      const subjectID = `${input.request.id}:${input.agent.id}`
      const rejected = skip
        ? []
        : yield* intelligence
            .history(input.parentID, { operation: "subagent_brief", subjectID, decision: "needs_revision", limit: 1 })
            .pipe(Effect.orElseSucceed(() => []))
      const evaluation = skip
        ? undefined
        : yield* intelligence
            .evaluate(
              IntelligenceSubagentReview.briefEvaluation({
                sessionID: input.parentID,
                subjectID,
                attempt: rejected.length,
                requests: input.request.texts,
                agent: { name: input.agent.id, description: input.agent.description, writeCapable: input.writeCapable },
                findings,
                description: input.params.description,
                brief,
                model: input.params.model,
              }),
            )
            .pipe(Effect.orElseSucceed(() => undefined))
      const verdict = IntelligenceSubagentReview.briefVerdict({
        findings,
        single: yield* single,
        evaluation,
        rejectedBefore: rejected.length > 0,
      })
      if (!verdict.launch)
        return yield* new ToolFailure({ message: IntelligenceSubagentReview.rejection(input.agent.id, verdict.review) })
      return verdict.review
    })

    /** What the child did since `from`, the prompt of this call: its replies, tool calls and checkpoints. */
    const settled = Effect.fn("SubagentTool.settled")(function* (childID: SessionSchema.ID, from: SessionMessage.ID) {
      const messages = yield* sessions.context(childID)
      // A compaction may have folded the prompt away; then all the history is this call's.
      const window = messages.slice(messages.findIndex((message) => message.id === from) + 1)
      const replies = window.filter((message): message is SessionMessage.Assistant => message.type === "assistant")
      const reply = replies.findLast((message) => message.time.completed !== undefined && message.error === undefined)
      return {
        replyID: reply?.id,
        text: SubagentCompletion.text(reply),
        parts: replies.flatMap(SessionStopLoss.parts),
        checkpoints: window.flatMap((message) => {
          if (message.type !== "synthetic") return []
          const checkpoint = SubagentReview.checkpoint(message, DateTime.toEpochMillis(message.time.created))
          return checkpoint ? [checkpoint] : []
        }),
      }
    })

    /** Keeps the verdict and the checkpoints in the child's brief, read fresh right before the write. */
    const record = Effect.fn("SubagentTool.record")(function* (
      childID: SessionSchema.ID,
      update: { readonly result?: SubagentReview.Result; readonly checkpoints: ReadonlyArray<SubagentReview.Checkpoint> },
    ) {
      const child = yield* sessions.get(childID)
      const brief = SubagentReview.read(child.metadata)
      if (!brief || (!update.result && !update.checkpoints.length)) return
      yield* sessions.setMetadata({
        sessionID: childID,
        metadata: SubagentReview.write(child.metadata, {
          ...brief,
          ...(update.result ? { result: update.result } : {}),
          checkpoints: [...(brief.checkpoints ?? []), ...update.checkpoints].slice(-SubagentReview.CHECKPOINT_LIMIT),
        }),
      })
    })

    const judge = Effect.fn("SubagentTool.judge")(function* (input: {
      readonly parentID: SessionSchema.ID
      readonly child: SessionSchema.Info
      readonly brief: SubagentReview.Brief
      readonly prompt: string
      readonly run: Effect.Success<ReturnType<typeof settled>>
      readonly repaired: boolean
    }) {
      // The job reports a stand-in text for an empty reply; the checks must see it as empty.
      const text = input.run.text === SubagentCompletion.NO_TEXT ? "" : input.run.text
      const findings = IntelligenceSubagentReview.resultChecks(
        { text, parts: input.run.parts },
        {
          criteria: input.brief.criteria,
          scope: input.brief.scope,
          changesRequested: input.brief.writeCapable,
          directory: input.child.location.directory,
        },
      )
      const reasoning = yield* single
      if (reasoning || findings.some((finding) => finding.blocking))
        return IntelligenceSubagentReview.judge({ findings, single: reasoning, repaired: input.repaired })
      const evaluation = yield* intelligence
        .evaluate(
          IntelligenceSubagentReview.resultEvaluation({
            sessionID: input.parentID,
            childID: input.child.id,
            candidateID: input.run.replyID,
            repaired: input.repaired,
            brief: input.brief,
            prompt: input.prompt,
            findings,
            text,
            parts: input.run.parts,
            directory: input.child.location.directory,
          }),
        )
        .pipe(Effect.orElseSucceed(() => undefined))
      return IntelligenceSubagentReview.judge({ findings, evaluation, single: false, repaired: input.repaired })
    })

    /**
     * Reviews a finished run against the brief the child was launched under, with one repair round
     * in the same child when it falls short, and appends the verdict the parent reads. A run the
     * stop-loss ended is not reviewed or repaired: it is handed back as incomplete.
     */
    const reviewResult = Effect.fn("SubagentTool.reviewResult")(function* (input: {
      readonly parentID: SessionSchema.ID
      readonly childID: SessionSchema.ID
      readonly from: SessionMessage.ID
      readonly prompt: string
      readonly text: string
    }) {
      const child = yield* sessions.get(input.childID)
      const brief = SubagentReview.read(child.metadata)
      const first = yield* settled(input.childID, input.from)
      const stop = stopped(first.checkpoints)
      if (stop) {
        yield* record(input.childID, { result: stop.result, checkpoints: first.checkpoints })
        return `${input.text}\n\n${stop.block}`
      }
      if (!SubagentReview.supervised(brief)) {
        yield* record(input.childID, { checkpoints: first.checkpoints })
        return input.text
      }
      const subject = { parentID: input.parentID, child, brief, prompt: input.prompt }
      const verdict = yield* judge({ ...subject, run: first, repaired: false })
      if (verdict.decision !== "needs_revision") {
        yield* record(input.childID, {
          result: IntelligenceSubagentReview.recorded(verdict, Date.now()),
          checkpoints: first.checkpoints,
        })
        return `${input.text}\n\n${IntelligenceSubagentReview.reviewBlock(verdict)}`
      }
      // One repair round a call, in the same child, and one review after it: the parent reads
      // whatever that second review says. A repair that cannot be admitted keeps the first verdict.
      const second = yield* sessions
        .prompt({ sessionID: input.childID, text: IntelligenceSubagentReview.repair(verdict), resume: false })
        .pipe(
          Effect.andThen(sessions.resume(input.childID)),
          Effect.andThen(settled(input.childID, input.from)),
          Effect.orElseSucceed(() => undefined),
        )
      if (!second) {
        yield* record(input.childID, {
          result: IntelligenceSubagentReview.recorded(verdict, Date.now()),
          checkpoints: first.checkpoints,
        })
        return `${input.text}\n\n${IntelligenceSubagentReview.reviewBlock(verdict)}`
      }
      const stopRepair = stopped(second.checkpoints)
      if (stopRepair) {
        yield* record(input.childID, { result: stopRepair.result, checkpoints: second.checkpoints })
        return `${second.text}\n\n${stopRepair.block}`
      }
      const revised = yield* judge({ ...subject, run: second, repaired: true })
      yield* record(input.childID, {
        result: IntelligenceSubagentReview.recorded(revised, Date.now()),
        checkpoints: second.checkpoints,
      })
      return `${second.text}\n\n${IntelligenceSubagentReview.reviewBlock(revised)}`
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const started = Date.now()
              const parent = yield* sessions
                .get(context.sessionID)
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                  ),
                )
              let current = parent
              let depth = 0
              while (current.parentID) {
                depth++
                current = yield* sessions
                  .get(current.parentID)
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Parent session not found: ${current.parentID}`, error }),
                    ),
                  )
              }
              const caps = limits(yield* config.entries())
              if (depth >= caps.depth)
                return yield* new ToolFailure({
                  message: `Subagent depth limit reached (${caps.depth}). Increase "experimental.subagent_depth" to allow nested subagents.`,
                })
              const agent = yield* agents.resolve(input.agent)
              if (agent === undefined) return yield* new ToolFailure({ message: `Unknown agent: ${input.agent}` })
              if (agent.mode === "primary")
                return yield* new ToolFailure({ message: `Agent ${input.agent} cannot run as a subagent` })
              yield* permission
                .assert({
                  action: name,
                  resources: [agent.id],
                  save: [agent.id],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: {
                    type: "tool",
                    messageID: context.messageID,
                    id: context.id,
                  },
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: `Subagent denied: ${agent.id}`, error })))

              const existing =
                input.sessionID === undefined
                  ? undefined
                  : yield* sessions
                      .get(input.sessionID)
                      .pipe(
                        Effect.mapError(
                          (error) =>
                            new ToolFailure({ message: `Subagent session not found: ${input.sessionID}`, error }),
                        ),
                      )
              if (existing !== undefined && existing.parentID !== context.sessionID)
                return yield* new ToolFailure({
                  message: `Session ${existing.id} is not a child of the current session`,
                })
              const override = input.model === undefined ? undefined : yield* resolveModel(input.model)
              const isBackground = input.background === true
              // Joining a running child steers it; it takes no new slot and no review of its own.
              const joining = existing !== undefined && (yield* jobs.get(existing.id))?.status === "running"

              const history =
                existing === undefined ? yield* sessions.context(parent.id).pipe(Effect.orElseSucceed(() => [])) : []
              const request = latestRequest(history)
              if (existing === undefined) {
                const count = (yield* sessions.list({ parentID: parent.id })).data.filter(
                  (child) => DateTime.toEpochMillis(child.time.created) >= request.created,
                ).length
                if (count >= caps.perRequest)
                  return yield* new ToolFailure({ message: refusal("per_request", count, caps.perRequest) })
              }
              const writeCapable = ["edit", "shell"].some(
                (action) =>
                  Permission.evaluate(action, "*", agent.permissions, parent.permissions ?? []).effect !== "deny",
              )
              const brief =
                existing === undefined
                  ? yield* reviewBrief({ params: input, parentID: parent.id, agent, writeCapable, request })
                  : undefined
              const note = brief && IntelligenceSubagentReview.note(brief)
              const briefNote =
                brief && note ? `<brief_review verdict="${brief.verdict}">${note}</brief_review>` : undefined

              const slots = isBackground ? background : foreground
              const cap = isBackground ? caps.background : caps.concurrent
              const token = `${context.messageID}:${context.id}`
              const taken = joining ? undefined : admit(slots, parent.id, token, cap)
              if (taken !== undefined)
                return yield* new ToolFailure({ message: refusal(isBackground ? "background" : "concurrent", taken, cap) })
              const free = Effect.sync(() => {
                release(slots, parent.id, token)
                if (!foreground.has(parent.id)) running.delete(parent.id)
              })

              const launched = Effect.gen(function* () {
                // Continuing with a different agent switches the child, mirroring create semantics
                // where an explicit model wins over the agent's configured model, which wins over the inherited one.
                if (existing !== undefined) {
                  const switched = existing.agent !== agent.id
                  const model = override ?? (switched ? agent.model : undefined)
                  yield* Effect.all([
                    switched ? sessions.switchAgent({ sessionID: existing.id, agent: agent.id }) : Effect.void,
                    model === undefined ? Effect.void : sessions.switchModel({ sessionID: existing.id, model }),
                  ]).pipe(
                    Effect.mapError(
                      (error) =>
                        new ToolFailure({ message: `Failed to switch subagent session: ${existing.id}`, error }),
                    ),
                  )
                }

                const model = override ?? agent.model ?? parent.model
                const child =
                  existing ??
                  (yield* sessions
                    .create({
                      parentID: context.sessionID,
                      title: input.description,
                      agent: Agent.ID.make(input.agent),
                      model,
                      metadata: SubagentReview.write(parent.metadata, {
                        prompt: input.prompt,
                        agent: agent.id,
                        scope: input.scope ?? [],
                        criteria: input.done_criteria ?? [],
                        ...(input.return_format?.trim() ? { returnFormat: input.return_format.trim() } : {}),
                        writeCapable,
                        parentSessionID: parent.id,
                        verdict: brief?.verdict ?? "skipped",
                        issues: brief?.issues ?? [],
                        ...(brief?.evaluationID ? { evaluationID: brief.evaluationID } : {}),
                        created: started,
                      }),
                    })
                    .pipe(
                      Effect.mapError(
                        (error) =>
                          new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                      ),
                    ))

                const start = yield* hooks.run({
                  event: "SubagentStart",
                  matcher: input.agent,
                  session_id: context.sessionID,
                  agent_id: child.id,
                  agent_type: input.agent,
                })
                const instructions =
                  existing === undefined
                    ? IntelligenceSubagentReview.instructions({
                        scope: input.scope,
                        criteria: input.done_criteria,
                        returnFormat: input.return_format,
                      })
                    : undefined
                const prompt = [input.prompt, instructions, start.additionalContext].filter(Boolean).join("\n\n")
                yield* context.progress({ sessionID: child.id, status: "running" })

                const run = Effect.gen(function* () {
                  // Standard prompt admission outside the job: Job.start joining a running child skips
                  // its run effect, and the default wake starts an idle child or steers a running one.
                  const admitted = yield* sessions
                    .prompt({
                      sessionID: child.id,
                      text:
                        existing === undefined
                          ? ["You are a subagent spawned by another session.", prompt].join("\n")
                          : prompt,
                      ...(isBackground && existing === undefined ? { resume: false } : {}),
                    })
                    .pipe(
                      Effect.mapError(
                        (error) => new ToolFailure({ message: `Failed to prompt subagent: ${child.id}`, error }),
                      ),
                    )

                  const recovery = {
                    kind: "subagent" as const,
                    parentSessionID: context.sessionID,
                    childSessionID: child.id,
                    agent: agent.name,
                    description: input.description,
                  }
                  yield* subagents.start(recovery, (text) =>
                    reviewResult({
                      parentID: parent.id,
                      childID: child.id,
                      from: admitted.id,
                      prompt: input.prompt,
                      text,
                    }),
                  )

                  if (isBackground) {
                    yield* subagents.background(recovery)
                    // The slot is held until the child reports, not until this call returns.
                    yield* jobs
                      .wait({ id: child.id })
                      .pipe(Effect.ensuring(free), Effect.forkIn(scope, { startImmediately: true }))
                    return backgroundResult(child.id, briefNote)
                  }

                  const result = yield* jobs.block({ id: child.id, sessionID: context.sessionID }).pipe(
                    Effect.onInterrupt(() =>
                      Effect.all([sessions.interrupt(child.id), jobs.cancel(child.id)], {
                        discard: true,
                      }),
                    ),
                  )
                  if (result?.type === "backgrounded") {
                    yield* subagents.notify(recovery, result.info.started_at)
                    return backgroundResult(child.id, briefNote)
                  }
                  // Failure surfaces keep the sessionID visible so the model can continue the child.
                  if (result?.info.status === "error")
                    return yield* new ToolFailure({
                      message: `Subagent failed (sessionID: ${child.id}): ${result.info.error ?? "unknown error"}`,
                    })
                  if (result?.info.status === "cancelled")
                    return yield* new ToolFailure({ message: `Subagent cancelled (sessionID: ${child.id})` })
                  return {
                    sessionID: child.id,
                    status: "completed" as const,
                    output: [briefNote, result?.info.output ?? SubagentCompletion.NO_TEXT].filter(Boolean).join("\n"),
                  }
                })
                // Foreground subagents of one parent run `subtask_concurrency` at a time; the rest wait in order.
                if (isBackground || joining) return yield* run
                const semaphore = running.get(parent.id) ?? Semaphore.makeUnsafe(caps.subtasks)
                running.set(parent.id, semaphore)
                return yield* semaphore.withPermits(1)(run)
              })

              // A launched background child keeps its slot until it reports; everything else frees it here.
              const output = yield* launched.pipe(
                Effect.onExit((exit) =>
                  joining || (isBackground && Exit.isSuccess(exit) && exit.value.status === "running")
                    ? Effect.void
                    : free,
                ),
              )
              // The verdict this call's review kept on the child, for surfaces that read the task part.
              const child =
                output.status === "completed"
                  ? yield* sessions.get(output.sessionID).pipe(Effect.orElseSucceed(() => undefined))
                  : undefined
              const result = SubagentReview.read(child?.metadata)?.result
              return {
                output,
                review: result && result.at >= started ? result : undefined,
                brief: brief && brief.verdict !== "unverified" ? brief : undefined,
              }
            }).pipe(
              Effect.map((done) => ({
                output: done.output,
                content:
                  done.output.status === "completed"
                    ? `<subagent sessionID="${done.output.sessionID}" state="completed">\n${done.output.output}\n</subagent>`
                    : done.output.output,
                metadata: {
                  sessionID: done.output.sessionID,
                  status: done.output.status,
                  ...(done.brief ? { brief: { verdict: done.brief.verdict, issues: done.brief.issues } } : {}),
                  ...(done.review
                    ? {
                        review: {
                          decision: done.review.decision,
                          issues: done.review.issues,
                          repaired: done.review.repaired,
                        },
                      }
                    : {}),
                },
              })),
            ),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.sync(() => {
        if (event.tool !== name || !Predicate.isObject(event.input)) return
        if (event.input.model !== "" && event.input.sessionID !== "") return
        const input = { ...event.input }
        if (input.model === "") delete input.model
        if (input.sessionID === "") delete input.sessionID
        event.input = input
      }),
    )

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        const selected = yield* agents.resolve(event.agent)
        if (!selected) return
        const available = (yield* agents.list())
          .filter(
            (agent) =>
              agent.mode !== "primary" &&
              !agent.hidden &&
              Permission.evaluate(name, agent.id, selected.permissions).effect !== "deny",
          )
          .toSorted((a, b) => a.id.localeCompare(b.id))
        if (available.length === 0) return
        tool.description = [
          tool.description,
          "",
          "Available subagents:",
          ...available.map(
            (agent) =>
              `- ${agent.id}: ${agent.description ?? "This subagent should only be called when explicitly requested."}`,
          ),
        ].join("\n")
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}

interface Request {
  readonly id: string
  readonly created: number
  readonly texts: ReadonlyArray<string>
}

/** The latest thing a person asked in the parent, and when, with the two requests before it. */
function latestRequest(messages: ReadonlyArray<SessionMessage.Info>): Request {
  const requests = messages.filter((message): message is SessionMessage.User => message.type === "user")
  const latest = requests.at(-1)
  return {
    id: latest?.id ?? "",
    created: latest ? DateTime.toEpochMillis(latest.time.created) : 0,
    texts: requests.slice(-3).map((message) => message.text),
  }
}

/** The stop-loss ended the run when its latest checkpoint was not a hint. */
function stopped(checkpoints: ReadonlyArray<SubagentReview.Checkpoint>) {
  const last = checkpoints.at(-1)
  if (!last || last.action === "steer") return undefined
  return {
    result: { decision: "unverified" as const, issues: ["stopped"], repaired: false, at: last.at },
    block: IntelligenceSubagentReview.stoppedBlock(last.line),
  }
}
