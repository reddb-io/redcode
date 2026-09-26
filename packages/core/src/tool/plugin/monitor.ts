export * as MonitorTool from "./monitor.js"

import { realpath } from "node:fs/promises"
import path from "path"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Monitor } from "@opencode/schema/monitor"
import { Effect, Schema, Scope } from "effect"
import { FileAccess } from "../../file-access.js"
import { Location } from "../../location.js"
import { MonitorProbe } from "../../monitor-probe.js"
import { MonitorRuntime } from "../../monitor.js"
import { Permission } from "../../permission.js"
import { SafeRegex } from "../../safe-regex.js"
import { Session } from "../../session.js"
import type { Tool } from "../../tool.js"

export const name = "monitor"
export const ALWAYS_ASK_MS = 600_000

/** Resolve existing symlinks while allowing a missing file to become visible later. */
async function resolveReal(target: string) {
  const missing: string[] = []
  let current = target
  while (true) {
    try {
      return path.join(await realpath(current), ...missing.toReversed())
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return target
      missing.push(path.basename(current))
      current = parent
    }
  }
}

export const Plugin = {
  id: "opencode.tool.monitor",
  effect: Effect.fn("MonitorTool.Plugin")(function* (ctx: Context) {
    const monitors = yield* MonitorRuntime.Service
    const sessions = yield* Session.Service
    const permission = yield* Permission.Service
    const access = yield* FileAccess.Service
    const location = yield* Location.Service
    const scope = yield* Scope.Scope

    const start = Effect.fn("MonitorTool.start")(function* (input: Monitor.Control, context: Tool.Context) {
      const probe = input.probe
      if (!probe) return yield* Effect.fail(new Error('action "probe" needs a probe object'))
      const problem = Monitor.probeProblem(probe)
      if (problem) return yield* Effect.fail(new Error(`Invalid probe: ${problem}`))
      const options: Monitor.Options = {
        mode: "poll",
        ...(input.wait_ms === undefined ? {} : { wait_ms: input.wait_ms }),
        ...(input.interval_ms === undefined ? {} : { interval_ms: input.interval_ms }),
        ...(input.deadline_ms === undefined ? {} : { deadline_ms: input.deadline_ms }),
      }
      const force = Monitor.deadline(options) > ALWAYS_ASK_MS
      const label = Monitor.probeLabel(probe)
      const metadata = { monitor: Monitor.summary(options), probe: label }
      const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
      const interval = options.interval_ms ?? Monitor.DEFAULT_INTERVAL_MS
      const observe = yield* Effect.gen(function* () {
        if (probe.type === "http") {
          yield* permission.assert({
            action: "webfetch",
            resources: [probe.url],
            ...(force ? { force } : { save: ["*"] }),
            metadata: { ...metadata, url: probe.url, headers: Object.keys(probe.headers ?? {}) },
            sessionID: context.sessionID,
            agent: context.agent,
            source,
          })
          const original = yield* permission.evaluate({
            action: "webfetch",
            resources: [probe.url],
            sessionID: context.sessionID,
            agent: context.agent,
            source,
          })
          const variables = MonitorProbe.envNames(probe.headers)
          const host = new URL(probe.url).host
          yield* Effect.forEach(
            variables,
            (variable) =>
              permission.assert({
                action: "env",
                resources: [MonitorProbe.envPermissionPattern(variable, host)],
                force: true,
                metadata: { ...metadata, variable, host, url: probe.url },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              }),
            { discard: true },
          )
          const regex = SafeRegex.create()
          yield* Scope.addFinalizer(scope, Effect.sync(() => regex.close()))
          const timeoutMs = Math.min(MonitorProbe.HTTP_TIMEOUT_MS, interval)
          return {
            attemptTimeoutMs: timeoutMs,
            cleanup: () => regex.close(),
            run: () =>
              Effect.promise(() =>
                MonitorProbe.http(probe, {
                  timeoutMs,
                  env: Object.fromEntries(variables.map((name) => [name, process.env[name]])),
                  allowRedirect: async (next) => {
                    const effect = await Effect.runPromise(
                      permission.evaluate({
                        action: "webfetch",
                        resources: [next.href],
                        sessionID: context.sessionID,
                        agent: context.agent,
                        source,
                      }),
                    )
                    return effect === "allow" || (effect === "ask" && original !== "allow")
                  },
                  regex,
                }),
              ),
          }
        }
        if (probe.type === "file") {
          const lexical = path.resolve(location.directory, probe.path)
          const real = yield* Effect.promise(() => resolveReal(lexical))
          const targets = yield* Effect.forEach([lexical, real], (file) => access.resolve({ path: file, kind: "file" }))
          yield* access.authorizeExternal(targets, context, metadata)
          yield* permission.assert({
            action: "read",
            resources: targets.map((target) => target.resource),
            ...(force ? { force } : { save: ["*"] }),
            metadata: { ...metadata, filepath: lexical },
            sessionID: context.sessionID,
            agent: context.agent,
            source,
          })
          const hash = probe.state === "changed"
          const first = hash ? yield* Effect.promise(() => MonitorProbe.observeFile(lexical, { hash })) : undefined
          return {
            attemptTimeoutMs: undefined,
            cleanup: undefined,
            run: () =>
              Effect.gen(function* () {
                const now = yield* Effect.promise(() => resolveReal(lexical))
                if (now !== real && now !== lexical)
                  return yield* Effect.fail(new Error(`${probe.path} now resolves to a file that was not approved`))
                return MonitorProbe.fileResult(
                  probe,
                  yield* Effect.promise(() => MonitorProbe.observeFile(lexical, { hash })),
                  first,
                )
              }),
          }
        }
        if (force)
          yield* permission.assert({
            action: name,
            resources: [label],
            force: true,
            metadata,
            sessionID: context.sessionID,
            agent: context.agent,
            source,
          })
        return { attemptTimeoutMs: undefined, cleanup: undefined, run: () => Effect.sync(() => MonitorProbe.processCheck(probe)) }
      })
      const messages = yield* sessions.context(context.sessionID)
      const recentInput = messages.findLast((message) => message.type === "user" || message.type === "synthetic")
      const info = yield* monitors.start({
        sessionID: context.sessionID,
        originMessageID: messages.findLast((message) => message.type === "user")?.id,
        autonomous: recentInput?.type === "synthetic",
        command: label,
        workdir: location.directory,
        options,
        probe,
        ...(observe.attemptTimeoutMs === undefined ? {} : { attemptTimeoutMs: observe.attemptTimeoutMs }),
        ...(observe.cleanup === undefined ? {} : { cleanup: observe.cleanup }),
        run: () =>
          observe.run().pipe(
            Effect.map((result) => ({
              exit: result.probe.matched ? 0 : 1,
              output: result.output,
              truncated: result.probe.truncated === true,
              probe: result.probe,
            })),
          ),
      })
      return Monitor.render(info)
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: Monitor.probeInstructions,
          input: Monitor.Control,
          output: Schema.String,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.action === "probe") return yield* start(input, context)
              if (input.action === "list") return Monitor.renderList(yield* monitors.list(context.sessionID))
              if (!input.id) return yield* Effect.fail(new Error("Monitor id is required"))
              const info =
                input.action === "get"
                  ? yield* monitors.get(context.sessionID, input.id)
                  : input.action === "wait"
                    ? yield* monitors.wait(context.sessionID, input.id, input.wait_ms ?? 1_000)
                    : yield* monitors.cancel(context.sessionID, input.id)
              return info ? Monitor.render(info) : JSON.stringify({ error: "Monitor not found in this session" })
            }).pipe(
              Effect.map((result) => ({ output: result, content: result })),
              Effect.mapError((error) => new ToolFailure({ message: "Monitor failed", error })),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
