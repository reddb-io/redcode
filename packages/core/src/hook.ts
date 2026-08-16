export * as HookV2 from "./hook"

import { Hook } from "@opencode-ai/schema/hook"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import path from "path"
import { applyEdits, modify, parse } from "jsonc-parser"
import { AppProcess } from "./process"
import { Config } from "./config"
import { makeLocationNode } from "./effect/app-node"
import { httpClient } from "./effect/app-node-platform"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { Location } from "./location"
import { Shell } from "./shell"
import { Hash } from "./util/hash"

export const MAX_OUTPUT_BYTES = 1024 * 1024
export const MAX_RECURSION = 8

const executableEvents = new Set<Hook.Event>([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "PreCompact",
  "MessageDisplay",
])

const executableHandlers = new Set<Hook.HandlerType>(["command", "http"])

export interface Interface {
  readonly status: () => Effect.Effect<Hook.Status>
  readonly trust: () => Effect.Effect<Hook.Trust>
  readonly revoke: () => Effect.Effect<Hook.Trust>
  readonly importClaude: () => Effect.Effect<Hook.ImportResult, ImportError>
  readonly run: (input: Omit<Hook.Input, "cwd">) => Effect.Effect<Hook.Output>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Hook") {}

export class ImportError extends Schema.TaggedErrorClass<ImportError>()("Hook.ImportError", {
  message: Schema.String,
}) {}

export class BlockedError extends Schema.TaggedErrorClass<BlockedError>()("Hook.BlockedError", {
  event: Hook.Event,
  reason: Schema.String,
}) {}

export function requireAllowed(event: Hook.Event, output: Hook.Output) {
  return output.continue && output.decision !== "deny"
    ? Effect.succeed(output)
    : Effect.fail(new BlockedError({ event, reason: output.reason ?? `${event} hook denied the operation` }))
}

export function toolName(name: string) {
  const mapped: Record<string, string> = {
    bash: "Bash",
    shell: "Bash",
    read: "Read",
    write: "Write",
    edit: "Edit",
    apply_patch: "Edit",
    glob: "Glob",
    grep: "Grep",
    task: "Task",
    webfetch: "WebFetch",
    websearch: "WebSearch",
  }
  return mapped[name] ?? name
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const http = yield* HttpClient.HttpClient
    const location = yield* Location.Service
    const process = yield* AppProcess.Service
    const trustFile = path.join(global.state, "hook-trust.json")

    const definitions = Effect.fn("Hook.definitions")(function* () {
      const entries = yield* config.entries()
      return entries.flatMap((entry) => {
        if (entry.type !== "document" || !entry.info.hooks) return []
        return Object.entries(entry.info.hooks).flatMap(([event, matchers]) =>
          Schema.is(Hook.Event)(event)
            ? matchers.flatMap((matcher, matcherIndex) =>
                matcher.hooks.map((handler, handlerIndex) => {
                  const support = supportFor(event, handler.type)
                  return {
                    id: Hash.sha256(`${entry.path ?? "config"}:${event}:${matcherIndex}:${handlerIndex}`).slice(0, 16),
                    event,
                    matcher: matcher.matcher,
                    handler,
                    source: entry.path ?? "config",
                    support: support.support,
                    reason: support.reason,
                  } satisfies Hook.Definition
                }),
              )
            : [],
        )
      })
    })

    const fingerprint = Effect.fn("Hook.fingerprint")(function* () {
      return Hash.sha256(
        JSON.stringify(
          (yield* definitions()).map((definition) => ({
            event: definition.event,
            matcher: definition.matcher,
            handler: definition.handler,
            source: definition.source,
          })),
        ),
      )
    })

    const readTrust = Effect.fn("Hook.readTrust")(function* () {
      const stored = yield* fs.readJson(trustFile).pipe(Effect.catch(() => Effect.succeed({})))
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {}
      return Object.fromEntries(
        Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    })

    const currentTrust = Effect.fn("Hook.currentTrust")(function* () {
      const current = yield* fingerprint()
      const stored = yield* readTrust()
      return { trusted: stored[location.project.id] === current, fingerprint: current }
    })

    const writeTrust = Effect.fn("Hook.writeTrust")(function* (value?: string) {
      const stored = yield* readTrust()
      const next = Object.fromEntries(Object.entries(stored).filter(([projectID]) => projectID !== location.project.id))
      if (value) next[location.project.id] = value
      yield* fs.ensureDir(path.dirname(trustFile)).pipe(Effect.orDie)
      yield* fs.writeJson(trustFile, next, 0o600).pipe(Effect.orDie)
      return { trusted: value !== undefined, fingerprint: yield* fingerprint() }
    })

    const importClaude = Effect.fn("Hook.importClaude")(function* () {
      const sources = ["settings.json", "settings.local.json"].map((name) =>
        path.join(location.project.directory, ".claude", name),
      )
      const imported = yield* Effect.forEach(sources, (source) => fs.readFileStringSafe(source).pipe(Effect.orDie))
      const merged = imported.reduce<Record<string, Hook.Matcher[]>>((result, text) => {
        if (!text) return result
        const input: unknown = parse(text, [], { allowTrailingComma: true })
        const decoded = Schema.decodeUnknownOption(Schema.Struct({ hooks: Hook.Config.pipe(Schema.optional) }), {
          errors: "all",
          onExcessProperty: "ignore",
        })(input).pipe(Option.getOrUndefined)
        if (!decoded?.hooks) return result
        for (const [event, matchers] of Object.entries(decoded.hooks))
          result[event] = [...(result[event] ?? []), ...matchers]
        return result
      }, {})
      const count = Object.values(merged).reduce(
        (total, matchers) => total + matchers.reduce((sum, matcher) => sum + matcher.hooks.length, 0),
        0,
      )
      if (count === 0) return yield* new ImportError({ message: "No valid hooks found under .claude" })
      const documents = (yield* config.entries()).filter(
        (entry): entry is Config.Document =>
          entry.type === "document" &&
          entry.path !== undefined &&
          !FSUtil.contains(global.config, entry.path) &&
          FSUtil.contains(location.project.directory, entry.path),
      )
      // Prefer the highest-priority config the project already has, whatever it is named, so
      // hooks never land in a second file beside an existing one. Only a project with no config
      // at all gets one created, under the Redcode name.
      const target = documents.at(-1)?.path ?? path.join(location.project.directory, "redcode.json")
      const current = (yield* fs.readFileStringSafe(target).pipe(Effect.orDie)) ?? "{}\n"
      const next = applyEdits(
        current,
        modify(current, ["hooks"], merged, { formattingOptions: { tabSize: 2, insertSpaces: true } }),
      )
      yield* fs
        .writeWithDirs(target, next)
        .pipe(Effect.mapError(() => new ImportError({ message: `Could not write ${target}` })))
      return { imported: count, target, restart_required: true }
    })

    const status = Effect.fn("Hook.status")(function* () {
      const trust = yield* currentTrust()
      return {
        trust,
        definitions: (yield* definitions()).map((definition) =>
          definition.support === "active" && !trust.trusted
            ? { ...definition, support: "untrusted" as const, reason: "Project hooks require approval" }
            : definition,
        ),
      }
    })

    const run = Effect.fn("Hook.run")(function* (raw: Omit<Hook.Input, "cwd">) {
      const currentDepth = Number.parseInt(processEnv("OPENCODE_HOOK_DEPTH") ?? "0", 10)
      if (currentDepth >= MAX_RECURSION) return blocked(`Hook recursion limit reached (${MAX_RECURSION})`)
      const state = yield* status()
      const input = { ...raw, cwd: location.directory }
      const matched = state.definitions.filter(
        (definition) =>
          definition.event === input.event &&
          definition.support === "active" &&
          matches(definition.matcher, input.matcher ?? input.tool_name),
      )
      if (matched.length === 0) return allowed()
      const results = yield* Effect.forEach(
        matched,
        (definition) => execute(definition.handler, input, process, http),
        { concurrency: "unbounded" },
      )
      return merge(results)
    })

    return Service.of({
      status,
      trust: Effect.fn("Hook.trust")(function* () {
        return yield* writeTrust(yield* fingerprint())
      }),
      revoke: Effect.fn("Hook.revoke")(function* () {
        return yield* writeTrust()
      }),
      importClaude,
      run,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [AppProcess.node, Config.node, FSUtil.node, Global.node, Location.node, httpClient],
})

function supportFor(event: Hook.Event, handler: Hook.HandlerType) {
  if (!executableEvents.has(event))
    return { support: "unsupported" as const, reason: `Event ${event} has no native lifecycle equivalent` }
  if (!executableHandlers.has(handler))
    return { support: "unsupported" as const, reason: `Handler type ${handler} is not available in this host` }
  return { support: "active" as const }
}

function matches(pattern: string | undefined, value: string | undefined) {
  if (!pattern || pattern === "*") return true
  if (!value) return false
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

function allowed(output: Partial<Hook.Output> = {}): Hook.Output {
  return { continue: true, ...output }
}

function blocked(reason: string): Hook.Output {
  return { continue: false, decision: "deny", reason }
}

function merge(outputs: readonly Hook.Output[]) {
  const denied = outputs.find((output) => !output.continue || output.decision === "deny")
  if (denied) return denied
  return allowed({
    decision: outputs.some((output) => output.decision === "allow") ? "allow" : undefined,
    reason:
      outputs
        .map((output) => output.reason)
        .filter(Boolean)
        .join("\n") || undefined,
    additionalContext:
      outputs
        .map((output) => output.additionalContext)
        .filter(Boolean)
        .join("\n") || undefined,
    systemMessage:
      outputs
        .map((output) => output.systemMessage)
        .filter(Boolean)
        .join("\n") || undefined,
    suppressOutput: outputs.some((output) => output.suppressOutput),
    updatedInput: outputs.findLast((output) => output.updatedInput !== undefined)?.updatedInput,
  })
}

function execute(handler: Hook.Handler, input: Hook.Input, process: AppProcess.Interface, http: HttpClient.HttpClient) {
  if (handler.type === "command") return executeCommand(handler, input, process)
  if (handler.type === "http") return executeHttp(handler, input, http)
  return Effect.succeed(allowed())
}

function executeCommand(handler: typeof Hook.CommandHandler.Type, input: Hook.Input, process: AppProcess.Interface) {
  const shell = Shell.preferred()
  const execution = process.run(
    ChildProcess.make(shell, Shell.args(shell, handler.command, input.cwd), {
      cwd: input.cwd,
      extendEnv: true,
      env: {
        CLAUDE_PROJECT_DIR: input.cwd,
        OPENCODE_HOOK_DEPTH: String(Number.parseInt(processEnv("OPENCODE_HOOK_DEPTH") ?? "0", 10) + 1),
      },
    }),
    {
      stdin: JSON.stringify(input),
      timeout: `${handler.timeout ?? 600} seconds`,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxErrorBytes: MAX_OUTPUT_BYTES,
    },
  )
  if (handler.async)
    return Effect.sync(() => {
      Effect.runFork(
        execution.pipe(
          Effect.tapError((error) => Effect.logWarning("async hook failed", { command: handler.command, error })),
          Effect.ignore,
        ),
      )
      return allowed()
    })
  return execution.pipe(
    Effect.map((result) => {
      if (result.exitCode === 2) return blocked(result.stderr.toString("utf8").trim() || "Hook denied the operation")
      if (result.exitCode !== 0)
        return blocked(`Hook failed (${result.exitCode}): ${result.stderr.toString("utf8").trim()}`)
      if (result.stdoutTruncated || result.stderrTruncated)
        return blocked(`Hook output exceeded ${MAX_OUTPUT_BYTES} bytes`)
      return parseOutput(result.stdout.toString("utf8"))
    }),
    Effect.catch((error) => Effect.succeed(blocked(error.message))),
  )
}

function executeHttp(handler: typeof Hook.HttpHandler.Type, input: Hook.Input, http: HttpClient.HttpClient) {
  return HttpClientRequest.post(handler.url).pipe(
    HttpClientRequest.setHeaders({ "content-type": "application/json", ...handler.headers }),
    HttpClientRequest.bodyText(JSON.stringify(input), "application/json"),
    http.execute,
    Effect.flatMap((response) =>
      response.status >= 200 && response.status < 300
        ? response.text.pipe(
            Effect.map((text) =>
              Buffer.byteLength(text) > MAX_OUTPUT_BYTES
                ? blocked(`Hook output exceeded ${MAX_OUTPUT_BYTES} bytes`)
                : parseOutput(text),
            ),
          )
        : Effect.succeed(blocked(`HTTP hook returned ${response.status}`)),
    ),
    Effect.timeout(`${handler.timeout ?? 600} seconds`),
    Effect.catch((error) => Effect.succeed(blocked(String(error)))),
  )
}

const decodeOutput = Schema.decodeUnknownOption(Hook.Output, { onExcessProperty: "ignore" })

function parseOutput(value: string) {
  if (!value.trim()) return allowed()
  const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(value).pipe(
    Option.flatMap(decodeOutput),
    Option.getOrUndefined,
  )
  return parsed ?? blocked("Hook returned invalid JSON output")
}

function processEnv(name: string) {
  return typeof globalThis.process === "undefined" ? undefined : globalThis.process.env[name]
}
