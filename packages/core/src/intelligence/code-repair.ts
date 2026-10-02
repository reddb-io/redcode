export * as IntelligenceCodeRepair from "./code-repair.js"

import path from "node:path"
import { Effect, Option, Schema } from "effect"
import { Redact } from "@opencode/util/redact"
import { Intelligence } from "@opencode/schema/intelligence"
import { File } from "../file.js"
import { SessionMessage } from "../session/message.js"
import { SessionTaskFacts } from "../session/task-facts.js"
import { Tool } from "../tool.js"
import { IntelligenceEvaluation } from "./evaluation.js"

export const KEY = "codeRepair"
export const MAX_STEPS = 4
export const MAX_TOKENS = 2_048
export const RUBRIC = "code-behavior-v1"
const READ_ONLY = new Set(["read", "glob", "grep", "session_history"])
const EDITS = new Set(["edit", "write", "patch", "apply_patch"])
const ShellInput = Schema.Struct({
  command: Schema.String,
  workdir: Schema.optional(Schema.String),
  background: Schema.optional(Schema.Boolean),
})
export const Scope = Schema.Struct({
  directory: Schema.String,
  paths: Schema.Array(Schema.String),
  commands: Schema.Array(Schema.Struct({ command: Schema.String, workdir: Schema.String })),
})
export type Scope = typeof Scope.Type
const Marker = Schema.Struct({ userID: SessionMessage.ID, scope: Scope })

export const QUESTIONS = IntelligenceEvaluation.questions({
  code_behavior:
    "Does the actual code in sources.artifact contradict an explicit behavior required by sources.request? Trace a concrete input or execution path. Judge the implementation, not how convincing the candidate response is. Missing tests or truncated patches alone do not prove a defect.",
  code_contract:
    "Does the actual code in sources.artifact break an explicit API or state-preservation constraint in sources.request? A different implementation that satisfies the stated contract is not a defect. Do not invent requirements.",
})

/** Only the immutable candidate trees, never the final prose, establish what code was reviewed. */
export function artifact(input: {
  from: string
  to: string
  files: ReadonlyArray<Pick<File.Diff, "file" | "patch">>
  scrub?: (text: string) => string
}) {
  return {
    rubric: RUBRIC,
    from: input.from,
    to: input.to,
    totalFiles: input.files.length,
    omittedFiles: Math.max(0, input.files.length - 4),
    paths: input.files.slice(0, 4).map((file) => file.file),
    files: input.files.slice(0, 4).map((file) => ({
      path: file.file,
      patch: IntelligenceEvaluation.evidence(Redact.redact(input.scrub?.(file.patch) ?? file.patch), {
        reference: `${input.to}/${file.file}`,
        limit: 3_500,
      }),
    })),
  }
}

/** Scope comes from successful local edits and settled test calls for the current request. */
export function scope(results: ReadonlyArray<SessionTaskFacts.Result>, directory: string): Scope | undefined {
  const paths = [
    ...new Set(
      results
        .filter((result) => result.kind === "edit" && result.successful && result.settled)
        .flatMap((result) => result.paths)
        .filter((file) => {
          if (!path.isAbsolute(file)) return false
          const relative = path.relative(directory, file)
          return (
            relative.length > 0 &&
            relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
          )
        }),
    ),
  ]
  const commands = results.flatMap((result) => {
    if (result.tool !== "shell" || !result.settled || result.abandoned) return []
    const input = Schema.decodeUnknownOption(ShellInput)(result.input)
    if (
      Option.isNone(input) ||
      input.value.background ||
      !/^(?:bun (?:run )?test|npm test|pnpm test|yarn test|cargo test|go test)(?: [\w./=-]+)*$/.test(
        input.value.command,
      )
    )
      return []
    const workdir = path.resolve(directory, input.value.workdir ?? ".")
    const relative = path.relative(directory, workdir)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return []
    return [{ command: input.value.command, workdir }]
  })
  if (!paths.length || !commands.length) return undefined
  return {
    directory,
    paths,
    commands: commands.filter(
      (command, index) =>
        commands.findIndex((other) => other.command === command.command && other.workdir === command.workdir) === index,
    ),
  }
}

/** Restart recovery derives the remaining allowance from projected attempts; new user input supersedes it. */
export function state(messages: ReadonlyArray<SessionMessage.Info>) {
  const user = messages.findLast((message) => message.type === "user")
  if (!user) return undefined
  const at = messages.findLastIndex((message) => message.type === "synthetic" && message.metadata?.[KEY] !== undefined)
  const marker = messages[at]
  if (marker?.type !== "synthetic") return undefined
  const payload = Schema.decodeUnknownOption(Marker)(marker.metadata?.[KEY])
  if (Option.isNone(payload) || payload.value.userID !== user.id) return undefined
  const after = messages.slice(at + 1).filter((message) => message.type === "assistant")
  const latest = after.at(-1)
  return {
    scope: payload.value.scope,
    remaining: Math.max(0, MAX_STEPS - after.length),
    pending:
      after.length < MAX_STEPS && (!latest || (!latest.error && latest.content.some((part) => part.type === "tool"))),
  }
}

/** This restriction intersects the existing permission snapshot; it never grants another permission. */
export function restrict(snapshot: Tool.Snapshot, scope: Scope, final: boolean): Tool.Snapshot {
  const names = final ? new Set<string>() : new Set([...READ_ONLY, ...EDITS, "shell"])
  return {
    definitions: snapshot.definitions.filter((tool) => names.has(tool.name)),
    execute: (input) => {
      if (names.has(input.call.name) && READ_ONLY.has(input.call.name)) return snapshot.execute(input)
      if (names.has(input.call.name) && EDITS.has(input.call.name)) {
        const files = SessionTaskFacts.paths(input.call.name, input.call.input, scope.directory)
        if (files.length && files.every((file) => scope.paths.includes(file))) return snapshot.execute(input)
      }
      if (!final && input.call.name === "shell") {
        const shell = Schema.decodeUnknownOption(ShellInput)(input.call.input)
        if (
          Option.isSome(shell) &&
          !shell.value.background &&
          scope.commands.some(
            (command) =>
              command.command === shell.value.command &&
              command.workdir === path.resolve(scope.directory, shell.value.workdir ?? "."),
          )
        )
          return snapshot.execute(input)
      }
      return Effect.fail(
        new Tool.Error({
          message:
            "Code repair permits only scoped edits and previously used foreground test commands; its final Step has no tools",
        }),
      )
    },
  }
}

export function issues(evaluation: Intelligence.Evaluation | undefined) {
  if (!evaluation || evaluation.mode === "observe" || evaluation.decision === "unavailable") return []
  return Object.keys(QUESTIONS).filter((id) => {
    const answer = evaluation.answers[id]
    return answer?.type === "noul" && answer.noul >= Intelligence.REPAIR_CONFIDENCE
  })
}

export function verified(results: ReadonlyArray<SessionTaskFacts.Result>, scope: Scope) {
  const fresh = new Set(
    SessionTaskFacts.evidence(results, results.length)
      .calls.filter((call) => call.fresh)
      .map((call) => call.callID),
  )
  return results.some((result) => {
    if (result.tool !== "shell" || result.exit !== 0 || !fresh.has(result.callID)) return false
    const input = Schema.decodeUnknownOption(ShellInput)(result.input)
    return (
      Option.isSome(input) &&
      !input.value.background &&
      scope.commands.some(
        (command) =>
          command.command === input.value.command &&
          command.workdir === path.resolve(scope.directory, input.value.workdir ?? "."),
      )
    )
  })
}

export function prompt(issues: ReadonlyArray<string>, scope: Scope) {
  return [
    issues.includes("self_review")
      ? "Independently review your implementation against the original request. No defect has been established; verify a concrete counterexample before changing code."
      : `S1 suspects ${issues.join(", ")} in the implementation. This is a hypothesis; independently check it against the original request before changing code.`,
    `You have at most ${MAX_STEPS} Steps, each capped at ${MAX_TOKENS} output tokens. The last Step has no tools. Existing permissions and Session budgets still apply.`,
    `Only repair these already changed files: ${scope.paths.join(", ")}. Allowed foreground test calls: ${JSON.stringify(scope.commands)}.`,
    "Derive a concrete counterexample from the requested contract. If it confirms a defect, fix only that defect and rerun the relevant allowed test after the edit. If no defect is established, preserve the implementation. Do not modify tests to manufacture success, install dependencies, delegate, start background work or change tasks/goals.",
    "Give the complete final response with the actual changes and test results. State unresolved behavior explicitly; an exit code alone does not establish all requested behavior.",
  ].join("\n")
}
