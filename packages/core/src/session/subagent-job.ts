export * as SubagentJob from "./subagent-job.js"

import { Effect, Scope } from "effect"
import { HookRuntime } from "../hook.js"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { SubagentCompletion } from "./subagent-completion.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

/** Reviews the run's final text before it reaches the parent, and returns the text the parent reads. */
type Review = (text: string) => Effect.Effect<string, unknown>

interface Runner {
  start: (recovery: Recovery, review?: Review) => Effect.Effect<Job.Info>
  background: (recovery: Recovery) => Effect.Effect<void>
  notify: (recovery: Recovery, startedAt: number) => Effect.Effect<void>
}

export const make: Effect.Effect<Runner, never, Session.Service | Job.Service | HookRuntime.Service | Scope.Scope> =
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const hooks = yield* HookRuntime.Service
    const scope = yield* Scope.Scope
    // One observer per job generation, including continuations of the same child.
    const notifications = new Set<string>()

    const notify = Effect.fn("SubagentJob.notify")(function* (recovery: Recovery, startedAt: number) {
      const key = `${recovery.childSessionID}:${startedAt}`
      if (notifications.has(key)) return
      notifications.add(key)
      yield* Effect.gen(function* () {
        const info = (yield* jobs.wait({ id: recovery.childSessionID })).info
        if (info) yield* SubagentCompletion.deliver(sessions, jobs, { ...info, recovery })
      }).pipe(
        Effect.ensuring(Effect.sync(() => notifications.delete(key))),
        Effect.forkIn(scope, { startImmediately: true }),
      )
    })

    return {
      start: (recovery: Recovery, review?: Review) =>
        jobs.start({
          id: recovery.childSessionID,
          type: "subagent",
          title: recovery.description,
          metadata: {},
          recovery,
          run: Effect.gen(function* () {
            yield* sessions.resume(recovery.childSessionID)
            const messages = yield* sessions.messages({ sessionID: recovery.childSessionID, order: "desc", limit: 20 })
            const assistant = messages.find(
              (message) =>
                message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
            )
            const text = SubagentCompletion.text(assistant)
            const stop = yield* hooks.run({
              event: "SubagentStop",
              matcher: recovery.agent,
              session_id: recovery.parentSessionID,
              agent_id: recovery.childSessionID,
              agent_type: recovery.agent,
              last_assistant_message: text,
            })
            if ((stop.continue && stop.decision !== "deny") || !stop.reason) return text
            // Preserve the historical single correction; a hook cannot create an unbounded subagent loop.
            yield* sessions.prompt({ sessionID: recovery.childSessionID, text: stop.reason, resume: false })
            yield* sessions.resume(recovery.childSessionID)
            const corrected = yield* sessions.messages({ sessionID: recovery.childSessionID, order: "desc", limit: 20 })
            return SubagentCompletion.text(
              corrected.find(
                (message) =>
                  message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
              ),
            )
          }).pipe(Effect.flatMap((text) => (review ? review(text) : Effect.succeed(text)))),
        }),
      background: Effect.fn("SubagentJob.background")(function* (recovery: Recovery) {
        const info = yield* jobs.background(recovery.childSessionID)
        if (info) yield* notify(recovery, info.started_at)
      }),
      notify,
    }
  })
