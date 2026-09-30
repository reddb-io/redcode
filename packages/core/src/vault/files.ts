export * as VaultFiles from "./files.js"

import path from "path"
import { ToolFailure } from "@opencode/ai"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { Tool } from "@opencode/schema/tool"
import { reference } from "@opencode/schema/vault"
import type { Environment } from "../environment/index.js"
import { Permission } from "../permission.js"
import { gitExecutable } from "../util/git-executable.js"
import { VaultHosts } from "./hosts.js"
import { Vault } from "./vault.js"

/**
 * Secrets in files. A reference the model writes becomes its value only in a file meant for secrets, and only
 * after the user approved that secret for that file: a path git ignores, or, outside a repository, a `.env`-style
 * name. Such a file is edited in its reference form, so the model's view, diffs and prompts carry names while the
 * file on disk holds values; a later read shows references again because every result is scrubbed. Any other file
 * keeps references literally, and the tool says so.
 */
export interface Mode {
  /** Every vaulted value replaced by its reference, for everything shown: previews, diffs and prompts. */
  readonly clean: (text: string) => string
  /** Whether the file is edited in its reference form and written with values. */
  readonly secret: boolean
  /** References the input writes, which a secret file receives and any other file keeps as text. */
  readonly names: ReadonlyArray<string>
}

const TEMPLATE = /\.(?:example|sample|template|dist|defaults?)$/i

/** Whether a file name reads as an environment file, such as `.env`, `.env.local` or `app.env`, and not a template. */
export const envNamed = (file: string) => {
  const base = path.basename(file)
  return (base === ".env" || base.startsWith(".env.") || base.endsWith(".env")) && !TEMPLATE.test(base)
}

/** The notice a result ends with when references stayed literal. */
export const notice = (names: ReadonlyArray<string>) =>
  names.length === 0
    ? ""
    : `${names.map(reference).join(", ")} ${names.length === 1 ? "was" : "were"} NOT resolved in this file (secrets are only written into .env-style ignored files); use an environment variable or ask the user.`

/**
 * How a file tool treats `file` when it writes `written` over `current`. Outside a Session's tool execution
 * nothing is vaulted and every file is plain.
 */
export const mode = Effect.fn("VaultFiles.mode")(function* (input: {
  readonly environment: Environment.Interface
  /** The Location directory, whose repository decides what git ignores. */
  readonly root: string
  readonly file: string
  readonly written: string
  readonly current: string
}) {
  const binding = yield* Vault.Current
  const clean = binding ? yield* binding.scrubber : (text: string) => text
  const names = Vault.references(input.written)
  const plain: Mode = { clean, secret: false, names }
  if (!binding || (names.length === 0 && clean(input.current) === input.current)) return plain
  return (yield* eligible(input.environment, input.root, input.file)) ? { ...plain, secret: true } : plain
})

/** The running call's scrubber, or no change outside a Session's tool execution. */
export const cleaner = Effect.gen(function* () {
  const binding = yield* Vault.Current
  return binding ? yield* binding.scrubber : (text: string) => text
})

/** `text` with every reference it holds replaced by the value, or a failure naming the first unknown one. */
export const fill = Effect.fn("VaultFiles.fill")(function* (text: string) {
  const vaulted = yield* Vault.resolveAll(Vault.references(text))
  if ("missing" in vaulted) return yield* new ToolFailure({ message: Vault.unknownReference(vaulted.missing) })
  return Vault.fill(text, vaulted.values)
})

/** Asks the user to let `names` into the file `resource`, at most once per secret and file unless always allowed. */
export const approve = (input: {
  readonly permission: Permission.Interface
  readonly context: Tool.Context
  readonly resource: string
  readonly names: ReadonlyArray<string>
}) =>
  VaultHosts.approve({
    permission: input.permission,
    context: input.context,
    names: input.names,
    destinations: { known: [`file:${input.resource}`] },
    detail: { file: input.resource },
  }).pipe(
    Effect.mapError(
      (error) =>
        new ToolFailure({ message: "feedback" in error ? `The user declined: ${error.feedback}` : error.message }),
    ),
  )

/**
 * Whether `file` is meant for secrets. Inside a repository only a path git ignores is, whatever its name, since
 * anything else may be committed; outside one, or where git cannot tell, an environment file name is.
 */
const eligible = Effect.fn("VaultFiles.eligible")(function* (
  environment: Environment.Interface,
  root: string,
  file: string,
) {
  // Exit 0: ignored. Exit 1: in a repository and not ignored. Anything else: no repository or no git.
  const exit = yield* Effect.scoped(
    environment.spawner
      .spawn(
        ChildProcess.make(gitExecutable, ["check-ignore", "--quiet", "--no-index", "--", file], {
          cwd: root,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      )
      .pipe(Effect.flatMap((handle) => handle.exitCode)),
  ).pipe(Effect.orElseSucceed(() => 128))
  if (exit === 0) return true
  if (exit === 1) return false
  return envNamed(file)
})
