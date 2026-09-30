export * as ShellTool from "./shell.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { Tool } from "@opencode/schema/tool"
import { Deferred, Effect, Schema, Scope } from "effect"
import { Config } from "../../config.js"
import { Environment } from "../../environment/index.js"
import { Job } from "../../job.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { NonNegativeInt } from "../../schema.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { Shell } from "../../shell.js"
import { ShellGuard } from "../../shell/guard.js"
import { ShellParse } from "../../shell/parse.js"
import { ShellSelect } from "../../shell/select.js"
import { ShellResult } from "../../shell/result.js"
import { ShellPolling } from "../shell-polling.js"
import { Vault } from "../../vault/vault.js"
import { VaultCapture } from "../../vault/capture.js"
import { VaultHosts } from "../../vault/hosts.js"
import { VaultShell } from "../../vault/shell.js"

export const name = "shell"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
/** Bytes of a stopped foreground command's output kept for its interrupted result. */
const PARTIAL_OUTPUT_BYTES = 4_000

const BACKGROUND_INSTRUCTION =
  "You will be notified automatically when the command finishes. The notification will include the command's output. Unless the user explicitly asks otherwise, DO NOT poll for completion, even if you need the final result to continue. Repeatedly sleeping and reading or searching the output file is polling, not useful work. You may read the current output if it lets you do useful work now, but do not repeatedly check it while waiting for the command to finish. Keep working on anything that does not depend on the result. If you have nothing else to do, end your response; you will be resumed automatically when the command finishes."
const OS =
  process.platform === "darwin"
    ? "macOS"
    : process.platform === "win32"
      ? "Windows"
      : process.platform === "linux"
        ? "Linux"
        : process.platform
const description = (shell?: string) =>
  [
    "Execute a shell command and return its output.",
    ...(shell ? [`Commands run on ${OS} using ${shell}.`] : []),
    "Quote file paths containing spaces or special characters.",
    "Prefer dedicated tools over shell commands when possible.",
    "When output is large, the full result is saved to a file and a truncated preview is returned.",
    "Rely on automatic truncation unless filtering the output is more useful.",
    "Commands accept an optional timeout, background commands have no timeout by default.",
    "Background commands return immediately, and you will be notified when they complete.",
    "A `{vault:<name>}` reference works anywhere in the command, in any quoting, heredoc or JSON body, and the command receives that secret without you seeing it; never print or echo it. Secrets in the output come back as references. Set `capture` to store an opaque value from the output, such as a token no pattern recognizes, and get back only its reference.",
    `Commands that discard or rewrite repository work are refused unless the user allowed them: git ${ShellGuard.FORBIDDEN_GIT.join(", git ")}, forced or deleting pushes, branch deletion, discarding switches, worktree removal, and recursive deletion of the repository; use a preserving alternative instead.`,
  ].join(" ")

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.optionalKey(Schema.String).annotate({
    description:
      "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
  }),
  timeout: Schema.optionalKey(NonNegativeInt).annotate({
    description: `Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to ${DEFAULT_TIMEOUT_MS} for foreground commands. Background commands have no timeout by default.`,
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
  }),
  capture: Schema.optionalKey(
    Schema.Struct({
      name: Schema.optionalKey(Schema.String).annotate({
        description: "Name of the reference; capturing again under the same name replaces the value.",
      }),
      from: Schema.String.annotate({
        description:
          'What to store after a successful exit: "stdout" (the whole output, trimmed), "json:$.path.to.field" or "regex:<pattern with one group>".',
      }),
    }),
  ).annotate({
    description:
      "Store part of the output as a vault secret and return only its {vault:name} reference instead of the output. The output combines stdout and stderr, so silence progress and errors (curl -s).",
  }),
})

export type Input = typeof Input.Type

const StructuredOutput = Schema.Struct({
  exit: Schema.optionalKey(Schema.Number),
  signal: Schema.optionalKey(Schema.String),
  shellID: Schema.optionalKey(Schema.String),
  truncated: Schema.Boolean,
  timeout: Schema.optionalKey(Schema.Boolean),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  status: Schema.optionalKey(Schema.Literals(["completed", "running"])),
})

type Output = typeof Output.Type

const resultMessages = (output: Output) => {
  const notice = output.status === "running" ? BACKGROUND_INSTRUCTION : ShellResult.notice(output)
  return [...(output.output ? [output.output] : []), ...(notice ? [notice] : [])]
}

const toolResult = (output: Output) => {
  return {
    output,
    content: resultMessages(output).map((text) => ({ type: "text" as const, text })),
    metadata: {
      status: output.status,
      ...ShellResult.metadata(output),
      ...(output.shellID !== undefined ? { shellID: output.shellID } : {}),
    },
  }
}

const backgroundResult = (shellID: string, file: string) => ({
  output: `Command moved to the background (shell ID: ${shellID}).\nOutput is streaming to: ${file}`,
  shellID,
  truncated: false,
  status: "running" as const,
})

export const Plugin = {
  id: "opencode.tool.shell",
  effect: Effect.fn("ShellTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const scope = yield* Scope.Scope
    const environment = yield* Environment.Service
    const access = yield* FileAccess.Service
    const shell = yield* Shell.Service
    const shellSelect = yield* ShellSelect.Service
    const compatibleShell = shellSelect.resolve({ priority: "compat" })
    const permission = yield* Permission.Service
    const config = yield* Config.Service

    // `--yolo` reaches the server in the root Session's client environment; a subagent shares its root's mode.
    const yolo = Effect.fn("ShellTool.yolo")(function* (sessionID: SessionSchema.ID) {
      let root = yield* sessions.get(sessionID).pipe(Effect.orElseSucceed(() => undefined))
      while (root?.parentID) {
        const parent = yield* sessions.get(root.parentID).pipe(Effect.orElseSucceed(() => undefined))
        if (!parent) break
        root = parent
      }
      if (!root) return false
      const environment = yield* sessions.environment({ sessionID: root.id }).pipe(Effect.orElseSucceed(() => undefined))
      return ShellGuard.lifted(environment, process.env)
    })

    const prepare = Effect.fn("ShellTool.prepare")(function* (invocation: Shell.Invocation, context: Tool.Context) {
      const source = {
        type: "tool" as const,
        messageID: context.messageID,
        id: context.id,
      }
      const target = yield* access.resolve({ path: invocation.cwd, kind: "directory" })
      invocation.cwd = target.absolute
      const timeout = invocation.timeout
      const portable = Config.latestExperimental(yield* config.entries(), "portable_shell_scanner") === true
      const parsed = yield* ShellParse.scan(invocation.command, invocation.shell, target.absolute, { portable })
      const directories = yield* Effect.forEach(parsed.directories, (directory) =>
        access.resolve({
          path: FileAccess.resolvePath(target.absolute, directory),
          kind: "directory",
        }),
      )
      yield* access.authorizeExternal([target, ...directories], context)
      // The repository guard refuses before any prompt; only `--yolo` or a rule the user wrote for the command lifts it.
      const root = yield* access.resolve({ path: ".", kind: "directory" })
      const refused = parsed.commands.flatMap((command) => {
        const reason = ShellGuard.refusal(command.resource, { cwd: target.absolute, roots: [root.absolute] })
        return reason === undefined ? [] : [{ reason, resource: command.resource }]
      })
      if (
        refused.length > 0 &&
        !(yield* yolo(context.sessionID)) &&
        !(yield* permission.explicit({
          sessionID: context.sessionID,
          agent: context.agent,
          action: name,
          resources: refused.map((item) => item.resource),
        }))
      )
        return yield* new Permission.BlockedError({
          rules: [],
          permission: name,
          resources: refused.map((item) => item.resource),
          reason: ShellGuard.message(refused[0].reason, refused[0].resource),
        })
      if (parsed.commands.length > 0)
        yield* permission.assert({
          action: name,
          resources: parsed.commands.map((command) => command.resource),
          save: parsed.commands.map((command) => command.save),
          sessionID: context.sessionID,
          agent: context.agent,
          source,
        })
      // Approval can outlive the directory, so validate immediately before spawning.
      const workdir = yield* Environment.typeFollowing(environment.files, target.absolute).pipe(
        Effect.catchTag("Environment.NotFound", () =>
          Effect.fail(new Error(`Working directory does not exist: ${target.absolute}`)),
        ),
      )
      if (workdir !== "directory")
        return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.absolute}`))
      return { timeout, segments: parsed.commands.map((command) => command.resource) }
    })

    /**
     * The output as the model may read it: an explicit `capture` stores the part it names and shows only the
     * reference; otherwise every high-confidence secret in the output is stored and replaced by its reference,
     * with a note that names them. Both happen before the output reaches a result, a job or a notification.
     */
    const vaultOutput = Effect.fn("ShellTool.vaultOutput")(function* (
      /** The whole output up to the capture limit, where `shown` may be a truncated tail. */
      whole: Effect.Effect<string>,
      shown: { readonly output: string; readonly exit?: number },
      capture: Input["capture"],
      hosts: ReadonlyArray<string>,
      binding: Vault.Binding | undefined,
    ) {
      if (!binding) return shown.output
      if (capture && shown.exit === 0) {
        const selected = yield* VaultCapture.select(yield* whole, capture.from)
        if ("value" in selected) {
          // A named capture renews its own value; an unnamed one gets a new `captured-<n>` name each time.
          const name = yield* binding.set({
            name: capture.name ?? "",
            kind: "captured",
            value: selected.value,
            origin: "captured",
            hosts,
          })
          return `Stored the captured value as ${Vault.reference(name)}; use that reference in later commands. The output is not shown because it holds the secret.`
        }
        return `Nothing was captured: ${selected.failure}. The output is not shown because it may hold the secret.`
      }
      const captured = yield* binding.capture([shown.output], hosts)
      const note = Vault.captureNote(captured.names)
      const failed = capture ? `\n\nNothing was captured: the command exited with ${shown.exit ?? "no status"}.` : ""
      return `${captured.clean(shown.output)}${failed}${note ? `\n\n${note}` : ""}`
    })

    const notifyWhenDone = Effect.fn("ShellTool.notifyWhenDone")(
      function* (
        sessionID: SessionSchema.ID,
        id: string,
        shellID: string,
        command: string,
        settled: Deferred.Deferred<Output>,
        vault: Vault.Binding | undefined,
      ) {
        const info = (yield* jobs.wait({ id })).info
        if (!info || info.status === "running") return
        const output = info.status === "completed" ? yield* Deferred.await(settled) : undefined
        const result = output
          ? resultMessages(output).join("\n\n")
          : info.status === "error"
            ? (info.error ?? "Command failed")
            : "Cancelled"
        // The notification skips the tool result path, so it scrubs vaulted values itself.
        const text = vault ? yield* vault.scrub(result) : result
        yield* sessions.synthetic({
          ...(info.notificationID ? { id: info.notificationID } : {}),
          sessionID,
          description: command,
          ...ShellResult.notification({
            jobID: id,
            shellID,
            command,
            state: info.status,
            text,
            output,
          }),
        })
        if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
      },
      Effect.forkIn(scope, { startImmediately: true }),
    )

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: description(),
          input: Input,
          output: Output,
          execute: (input, context) => {
            const polling = input.background === true ? undefined : ShellPolling.detect(input.command)
            if (polling)
              return Effect.fail(new ToolFailure({
                message: polling.probe
                  ? ShellPolling.probeRefusal(polling, input.workdir)
                  : ShellPolling.boundedRefusal(polling, input.workdir),
              }))
            return Effect.gen(function* () {
              const timeout = input.background === true ? (input.timeout ?? 0) : (input.timeout ?? DEFAULT_TIMEOUT_MS)
              let finalTimeout = timeout
              // Values stay out of the command: approval and the stored input see the reference, and the shell reads
              // the script with the values written in on its standard input, once the user let them go where it sends.
              const vaulted = yield* Vault.resolveAll(Vault.references(input.command))
              if ("missing" in vaulted)
                return yield* new ToolFailure({ message: Vault.unknownReference(vaulted.missing) })
              const values = vaulted.values
              const binding = yield* Vault.Current
              // Where the command sends what it carries; a secret found in its output may go back there unasked.
              let hosts: ReadonlyArray<string> = []
              const info = yield* shell.create(
                {
                  command: input.command,
                  cwd: input.workdir,
                  timeout,
                  shell: yield* compatibleShell,
                  metadata: { sessionID: context.sessionID },
                },
                (invocation) =>
                  Effect.gen(function* () {
                    const prepared = yield* prepare(invocation, context)
                    finalTimeout = prepared.timeout
                    const destinations = VaultHosts.shell(prepared.segments)
                    hosts = "known" in destinations ? destinations.known.filter(VaultHosts.isHost) : []
                    if (values.size === 0) return
                    yield* VaultHosts.approve({
                      permission,
                      context,
                      names: Array.from(values.keys()),
                      destinations,
                      detail: { command: input.command },
                    })
                    const bound = VaultShell.bind(invocation.command, invocation.shell, values)
                    if ("failure" in bound) return yield* new ToolFailure({ message: bound.failure })
                    invocation.command = bound.command
                    invocation.script = bound.script
                    invocation.env = { ...invocation.env, ...bound.env }
                  }),
              )
              yield* context.progress({ shellID: info.id })

              const settled = yield* Deferred.make<Output>()
              const run = Effect.gen(function* () {
                const result = yield* shell.result(info)
                if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
                const shown = ShellResult.output(result)
                const whole = shell
                  .output(info.id, { limit: VaultCapture.MAX_BYTES })
                  .pipe(Effect.map((page) => page.output), Effect.orDie)
                const output = { ...shown, output: yield* vaultOutput(whole, shown, input.capture, hosts, binding) }
                return {
                  ...output,
                  output: output.timeout
                    ? `${output.output}\n\nCommand exceeded timeout of ${finalTimeout} ms. Retry with a larger timeout if the command is expected to take longer.`
                    : output.output,
                  status: "completed" as const,
                }
              }).pipe(
                Effect.tap((output) => Deferred.succeed(settled, output)),
                Effect.map((output) => resultMessages(output).join("\n\n")),
                Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)),
              )
              const job = yield* jobs.start({
                // CodeMode children share a tool-call ID, but each shell must own its job.
                id: info.id,
                type: name,
                title: info.command,
                metadata: { sessionID: context.sessionID, shellID: info.id },
                recovery: {
                  kind: "shell",
                  sessionID: context.sessionID,
                  shellID: info.id,
                  command: info.command,
                },
                run,
              })

              if (input.background === true) {
                yield* jobs.background(job.id)
                yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled, binding)
                return backgroundResult(info.id, info.file)
              }

              const result = yield* jobs.block({ id: job.id, sessionID: context.sessionID }).pipe(
                Effect.onInterrupt(() =>
                  // Record the tail of what the command printed, so its interrupted result can show it.
                  Effect.gen(function* () {
                    const head = yield* shell.output(info.id, { limit: PARTIAL_OUTPUT_BYTES })
                    const page =
                      head.cursor >= head.size
                        ? head
                        : yield* shell.output(info.id, {
                            cursor: head.size - PARTIAL_OUTPUT_BYTES,
                            limit: PARTIAL_OUTPUT_BYTES,
                          })
                    if (page.output.trim()) yield* context.progress({ shellID: info.id, output: page.output })
                  }).pipe(Effect.exit, Effect.andThen(jobs.cancel(job.id).pipe(Effect.ignore))),
                ),
              )
              if (result?.type === "backgrounded") {
                yield* shell.timeout(info.id, 0)
                yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled, binding)
                return backgroundResult(info.id, info.file)
              }
              if (result?.info.status === "error")
                return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
              if (result?.info.status === "cancelled") return yield* Effect.fail(new Error("Command cancelled"))

              return yield* Deferred.await(settled)
            }).pipe(
              Effect.map(toolResult),
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to execute command: ${input.command}`, error }),
              ),
            )
          },
        }),
      )
      .pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        tool.description = description(ShellSelect.name(yield* compatibleShell))
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
