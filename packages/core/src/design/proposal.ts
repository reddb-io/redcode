export * as DesignProposal from "./proposal"

import path from "node:path"
import { existsSync } from "node:fs"
import { Effect } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { ProjectDir } from "../project-dir"
import { DesignDetect } from "./detect"
import { DesignFiles } from "./files"
import { DesignManifest } from "./manifest"
import { DesignSystem } from "./system"

/**
 * The one-time "Use detected design system?" proposal shared by the TUI tool, the V2 tool and
 * `redcode design`. The answer lives in user state keyed by project directory, never in the
 * project's configuration: Yes writes the `design` section, No is remembered, Edit later snoozes.
 */

/** Config names from lowest to highest precedence, as both configuration loaders apply them. */
export const NAMES = ["opencode.json", "opencode.jsonc", "redcode.json", "redcode.jsonc", "config.json", "config.jsonc"]
export const STATE = "design-system-proposal.json"
export const SNOOZE = 24 * 60 * 60 * 1000
export const YES = "Yes"
export const LATER = "Edit later"
export const NO = "No"
export const HEADER = "Design system"
export const QUESTION = "Use detected design system?"

export type Answer = "yes" | "later" | "no"

export interface Design {
  readonly system?: unknown
  readonly application?: string
  readonly browser?: string
}

export type Outcome =
  | { readonly status: "configured" | "dismissed" | "snoozed" | "none" }
  | {
      readonly status: "adopted"
      readonly proposal: DesignDetect.Proposal
      readonly file: string
      readonly manifest: string
    }
  | { readonly status: "later" | "declined"; readonly proposal: DesignDetect.Proposal }

export const question = (proposal: DesignDetect.Proposal) => ({
  header: HEADER,
  custom: false,
  question: `${QUESTION}\n${DesignDetect.summary(proposal)}`,
  options: [
    { label: YES, description: "Write the design section into redcode.json and generate .red/DESIGN.md" },
    { label: LATER, description: "Not now; ask again in a day" },
    { label: NO, description: "Design from scratch and never ask again for this project" },
  ],
})

export const answer = (label: string | undefined): Answer => (label === YES ? "yes" : label === NO ? "no" : "later")

// State --------------------------------------------------------------------------------------------

type Entry = { readonly dismissed?: number; readonly snoozed?: number }

async function entries(state: string): Promise<Record<string, Entry>> {
  const value = await Bun.file(state)
    .json()
    .catch(() => undefined)
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Entry>) : {}
}

export async function status(state: string, directory: string, now = Date.now()) {
  const entry = (await entries(state))[path.resolve(directory)]
  if (entry?.dismissed) return "dismissed" as const
  if (entry?.snoozed && now - entry.snoozed < SNOOZE) return "snoozed" as const
  return undefined
}

export async function remember(state: string, directory: string, value: Answer, now = Date.now()) {
  const all = await entries(state)
  const key = path.resolve(directory)
  if (value === "yes") delete all[key]
  else all[key] = value === "no" ? { dismissed: now } : { snoozed: now }
  await DesignFiles.atomic(state, JSON.stringify(all, null, 2) + "\n")
}

// Configuration ------------------------------------------------------------------------------------

/** The config file Yes writes: the highest-precedence one the directory already has, else redcode.json. */
export function target(directory: string) {
  const existing = NAMES.toReversed().find((name) => existsSync(path.join(directory, name)))
  return path.join(directory, existing ?? "redcode.json")
}

function formatting(text: string) {
  const indent = /^([ \t]+)\S/m.exec(text)?.[1]
  if (indent?.startsWith("\t")) return { insertSpaces: false, tabSize: 1, eol: text.includes("\r\n") ? "\r\n" : "\n" }
  return { insertSpaces: true, tabSize: indent?.length ?? 2, eol: text.includes("\r\n") ? "\r\n" : "\n" }
}

/**
 * Adds `design.system` (and `design.application` for a package inside a monorepo) to the project
 * config with minimal text edits: other keys, comments and indentation stay as written. A config
 * that already declares `design.system` is left untouched; an unparsable one is refused.
 */
export async function write(directory: string, proposal: DesignDetect.Proposal) {
  const file = target(directory)
  const exists = await Bun.file(file).exists()
  const before = exists ? await Bun.file(file).text() : "{}\n"
  const errors: ParseError[] = []
  const current = parse(before, errors, { allowTrailingComma: true })
  if (errors.length || (current !== undefined && (typeof current !== "object" || Array.isArray(current))))
    throw new Error(`${path.basename(file)} is not a valid JSON object; add the design section by hand`)
  const design = (current as { design?: Design } | undefined)?.design
  if (design?.system !== undefined) return { file, changed: false }
  const formattingOptions = formatting(before)
  const system = JSON.parse(JSON.stringify(proposal.system))
  let next = applyEdits(before, modify(before, ["design", "system"], system, { formattingOptions }))
  if (proposal.application !== ".")
    next = applyEdits(next, modify(next, ["design", "application"], proposal.application, { formattingOptions }))
  if (!next.endsWith("\n")) next += formattingOptions.eol
  await DesignFiles.atomic(file, next)
  return { file, changed: true }
}

/**
 * The `design` section in effect for a directory, read statically the way the location config does:
 * the global directory, then project directories and files from the repository root down to the
 * directory, the last `design` found winning whole. For callers without a config service (`redcode design`).
 */
export async function configured(directory: string, global?: string): Promise<Design | undefined> {
  const chain: string[] = []
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    chain.unshift(current)
    if (existsSync(path.join(current, ".git")) || path.dirname(current) === current) break
  }
  const files = [
    ...(global ? NAMES.map((name) => path.join(global, name)) : []),
    ...chain.flatMap((dir) => NAMES.map((name) => path.join(dir, name))),
    ...chain.flatMap((dir) => ProjectDir.DIRS.flatMap((project) => NAMES.map((name) => path.join(dir, project, name)))),
  ]
  let found: Design | undefined
  for (const file of files) {
    const content = await Bun.file(file)
      .text()
      .catch(() => undefined)
    if (content === undefined) continue
    const value = parse(content, [], { allowTrailingComma: true }) as { design?: unknown } | undefined
    if (value?.design && typeof value.design === "object") found = value.design as Design
  }
  return found
}

// Flow ---------------------------------------------------------------------------------------------

export interface Input<E, R> {
  /** Project directory: where detection starts and where the config is written. */
  readonly directory: string
  /** A design's application, relative to directory, when the caller already knows it. */
  readonly application?: string
  /** File holding the answers, in user state. */
  readonly state: string
  /** Whether `design.system` is already configured. */
  readonly configured: boolean
  /** Asks the question and resolves the chosen option label, or undefined when dismissed. */
  readonly ask: (request: ReturnType<typeof question>) => Effect.Effect<string | undefined, E, R>
  readonly now?: number
}

/**
 * Asks once when a design system is detected and nothing is configured. Detection or state
 * failures never block the caller: they count as nothing detected.
 */
export const offer = <E, R>(input: Input<E, R>) =>
  Effect.gen(function* () {
    if (input.configured) return { status: "configured" } satisfies Outcome
    const now = input.now ?? Date.now()
    const previous = yield* Effect.promise(() => status(input.state, input.directory, now).catch(() => undefined))
    if (previous) return { status: previous } satisfies Outcome
    const proposal = yield* Effect.promise(() =>
      DesignDetect.detect(input.directory, { application: input.application }).catch(() => undefined),
    )
    if (!proposal) return { status: "none" } satisfies Outcome
    const choice = answer(yield* input.ask(question(proposal)))
    if (choice !== "yes") {
      yield* Effect.promise(() => remember(input.state, input.directory, choice, now).catch(() => undefined))
      return { status: choice === "no" ? "declined" : "later", proposal } satisfies Outcome
    }
    const written = yield* Effect.tryPromise(() => write(input.directory, proposal))
    const application = path.join(input.directory, proposal.application)
    const manifest = yield* Effect.promise(() =>
      DesignSystem.load(application, { refresh: true, manifest: true, declared: proposal.system.paths }).then(
        (loaded) => loaded.manifest,
        (error: unknown) => `${DesignManifest.FILE} not generated: ${String(error)}`,
      ),
    )
    yield* Effect.promise(() => remember(input.state, input.directory, "yes", now).catch(() => undefined))
    return { status: "adopted", proposal, file: written.file, manifest } satisfies Outcome
  })

/** The line a tool result carries so the agent knows what the user chose. Empty when nothing was asked. */
export function report(outcome: Outcome, directory: string) {
  if (outcome.status === "adopted")
    return `Design system: the user adopted the detected design system; wrote design.system to ${path.relative(directory, outcome.file) || outcome.file}${outcome.proposal.application !== "." ? ` for ${outcome.proposal.application}` : ""} (${DesignDetect.summary(outcome.proposal).split("\n").slice(1, -1).join("; ")}). ${outcome.manifest}.`
  if (outcome.status === "declined")
    return "Design system: the user declined the detected design system; do not propose it again and design from the brief."
  if (outcome.status === "later")
    return "Design system: the user postponed adopting the detected design system; it is not configured yet."
  return ""
}
