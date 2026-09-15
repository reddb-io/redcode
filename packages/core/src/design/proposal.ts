export * as DesignProposal from "./proposal"

import path from "node:path"
import { existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import { Effect, Exit, Schema } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { ConfigDesign } from "../config/design"
import { ProjectDir } from "../project-dir"
import { Flock } from "../util/flock"
import { DesignDetect } from "./detect"
import { DesignFiles } from "./files"
import { DesignManifest } from "./manifest"
import { DesignSystem } from "./system"

/**
 * The one-time "Use detected design system?" proposal shared by the TUI tool, the V2 tool and
 * `redcode design`. Answers live in user state keyed by project directory, never in the project's
 * configuration: Yes writes the `design` section, No is remembered, Edit later snoozes for a day.
 */

/** Config names from lowest to highest precedence, as both configuration loaders apply them. */
export const NAMES = ["opencode.json", "opencode.jsonc", "redcode.json", "redcode.jsonc", "config.json", "config.jsonc"]
export const STATE = "design-system-proposal.json"
export const SNOOZE = 24 * 60 * 60 * 1000
/** How long "nothing detected" is trusted while the project's top-level files are unchanged. */
export const NONE_TTL = 10 * 60 * 1000
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

export type Decision =
  | { readonly status: "configured" | "dismissed" | "snoozed" | "none" }
  | { readonly status: "yes" | "later" | "declined"; readonly proposal: DesignDetect.Proposal }

export type Outcome =
  | { readonly status: "configured" | "dismissed" | "snoozed" | "none" }
  | { readonly status: "later" | "declined"; readonly proposal: DesignDetect.Proposal }
  | {
      readonly status: "adopted"
      readonly proposal: DesignDetect.Proposal
      readonly file: string
      readonly manifest: string
    }
  | { readonly status: "failed"; readonly proposal: DesignDetect.Proposal; readonly message: string }

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

const canonicalJson = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b)))
      : item,
  )
const sameApplication = (a: string | undefined, b: string | undefined) =>
  path.posix.normalize(a ?? ".").replace(/\/+$/, "") === path.posix.normalize(b ?? ".").replace(/\/+$/, "")

// State --------------------------------------------------------------------------------------------

type Entry = {
  readonly dismissed?: number
  readonly snoozed?: number
  readonly none?: Readonly<Record<string, { readonly at: number; readonly stamp: string }>>
}

const locks = (state: string) => path.join(path.dirname(state), "locks")
const lock = { timeoutMs: 10_000, staleMs: 30_000 }

async function entries(state: string): Promise<Record<string, Entry>> {
  const value = await Bun.file(state)
    .json()
    .catch(() => undefined)
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Entry>) : {}
}

/** Read-modify-write of the state file under a cross-process lock, so concurrent answers are not lost. */
async function update(state: string, change: (all: Record<string, Entry>) => void) {
  await Flock.withLock(
    `design-proposal:${state}`,
    async () => {
      const all = await entries(state)
      change(all)
      await DesignFiles.atomic(state, JSON.stringify(all, null, 2) + "\n")
    },
    { ...lock, dir: locks(state) },
  )
}

export async function status(state: string, directory: string, now = Date.now()) {
  const entry = (await entries(state))[path.resolve(directory)]
  if (entry?.dismissed) return "dismissed" as const
  if (entry?.snoozed && now - entry.snoozed < SNOOZE) return "snoozed" as const
  return undefined
}

export async function remember(state: string, directory: string, value: Answer, now = Date.now()) {
  const key = path.resolve(directory)
  await update(state, (all) => {
    const { dismissed: _dismissed, snoozed: _snoozed, ...rest } = all[key] ?? {}
    all[key] = value === "no" ? { ...rest, dismissed: now } : value === "later" ? { ...rest, snoozed: now } : rest
  })
}

/**
 * Modification times of the files detection starts from; a change invalidates a cached "nothing
 * detected". Directory times only move when entries are added or removed directly inside them, so
 * the top-level `apps` and `packages` directories catch a new or removed workspace package, while an
 * edit deeper inside an existing package is seen only once NONE_TTL (ten minutes) has passed.
 */
async function stamp(directory: string, application = ".") {
  const files = [
    "",
    "package.json",
    "pnpm-workspace.yaml",
    "apps",
    "packages",
    application,
    `${application}/package.json`,
    `${application}/components.json`,
    `${application}/tsconfig.json`,
    `${application}/src`,
    `${application}/src/components`,
  ]
  const times = await Promise.all(
    files.map((file) =>
      stat(path.join(directory, file)).then(
        (info) => String(info.mtimeMs),
        () => "-",
      ),
    ),
  )
  return times.join(":")
}

async function cachedNone(state: string, directory: string, application: string | undefined, now: number) {
  const entry = (await entries(state))[path.resolve(directory)]?.none?.[application ?? "."]
  return entry !== undefined && now - entry.at < NONE_TTL && entry.stamp === (await stamp(directory, application))
}

async function rememberNone(state: string, directory: string, application: string | undefined, now: number) {
  const current = await stamp(directory, application)
  await update(state, (all) => {
    const key = path.resolve(directory)
    const entry = all[key] ?? {}
    all[key] = { ...entry, none: { ...entry.none, [application ?? "."]: { at: now, stamp: current } } }
  })
}

// Configuration ------------------------------------------------------------------------------------

export interface Layer {
  readonly file: string
  /** False for the user's global configuration directory. */
  readonly project: boolean
  /** The file exists but is not a JSON object; it is never written. */
  readonly invalid: boolean
  readonly design?: Design
}

/**
 * Existing configuration files from lowest to highest precedence, as the location config loads them:
 * the global directory, the config files from the repository root down to the directory, then the
 * project directories (`.opencode`, `.redcode`, `.red/code`) in the same order.
 */
export async function layers(directory: string, global?: string): Promise<Layer[]> {
  const chain: string[] = []
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    chain.unshift(current)
    if (existsSync(path.join(current, ".git")) || path.dirname(current) === current) break
  }
  const candidates = [
    ...(global ? NAMES.map((name) => ({ file: path.join(global, name), project: false })) : []),
    ...chain.flatMap((dir) => NAMES.map((name) => ({ file: path.join(dir, name), project: true }))),
    ...chain.flatMap((dir) =>
      ProjectDir.DIRS.flatMap((project) =>
        NAMES.map((name) => ({ file: path.join(dir, project, name), project: true })),
      ),
    ),
  ]
  const found: Layer[] = []
  for (const candidate of candidates) {
    const content = await Bun.file(candidate.file)
      .text()
      .catch(() => undefined)
    if (content === undefined) continue
    const errors: ParseError[] = []
    const value = parse(content, errors, { allowTrailingComma: true }) as unknown
    const object =
      value && typeof value === "object" && !Array.isArray(value) ? (value as { design?: unknown }) : undefined
    const design = object?.design && typeof object.design === "object" ? (object.design as Design) : undefined
    found.push({ ...candidate, invalid: errors.length > 0 || !object, ...(design ? { design } : {}) })
  }
  return found
}

/** The `design` section in effect over layers, merged key by key like the location config. */
export const effective = (list: readonly Layer[]) => ConfigDesign.merge(list.map((layer) => layer.design))

/** The effective `design` section for a directory, read statically; for callers without a config service. */
export async function configured(directory: string, global?: string) {
  return effective(await layers(directory, global))
}

/**
 * The config file Yes writes: the project file that supplies the effective `design` section, so
 * nothing more specific shadows the written system; else the highest-precedence project config
 * file; else a new redcode.json in the directory.
 */
export function target(list: readonly Layer[], directory: string) {
  const project = list.filter((layer) => layer.project)
  return (
    project.findLast((layer) => layer.design !== undefined)?.file ??
    project.at(-1)?.file ??
    path.join(directory, "redcode.json")
  )
}

function formatting(text: string) {
  const indent = /^([ \t]+)\S/m.exec(text)?.[1]
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  if (indent?.startsWith("\t")) return { insertSpaces: false, tabSize: 1, eol }
  return { insertSpaces: true, tabSize: indent?.length ?? 2, eol }
}

/**
 * Adds `design.system` (and `design.application` for a package inside a monorepo) to a config file
 * with minimal text edits: other keys, comments and indentation stay as written. A file that already
 * declares `design.system` is left untouched; an unparsable one is refused.
 */
export async function write(file: string, proposal: DesignDetect.Proposal) {
  const exists = await Bun.file(file).exists()
  const before = exists ? await Bun.file(file).text() : "{}\n"
  const errors: ParseError[] = []
  const current = parse(before, errors, { allowTrailingComma: true })
  if (errors.length || (current !== undefined && (typeof current !== "object" || Array.isArray(current))))
    throw new Error(`${path.basename(file)} is not a valid JSON object; add the design section by hand`)
  if ((current as { design?: Design } | undefined)?.design?.system !== undefined) return { file, changed: false }
  const formattingOptions = formatting(before)
  const system = JSON.parse(JSON.stringify(proposal.system))
  let next = applyEdits(before, modify(before, ["design", "system"], system, { formattingOptions }))
  if (proposal.application !== ".")
    next = applyEdits(next, modify(next, ["design", "application"], proposal.application, { formattingOptions }))
  if (!next.endsWith("\n")) next += formattingOptions.eol
  await DesignFiles.atomic(file, next)
  return { file, changed: true }
}

export interface Commit {
  readonly directory: string
  readonly global?: string
  readonly state: string
  readonly proposal: DesignDetect.Proposal
  readonly now?: number
}

/**
 * Writes an accepted proposal and generates the manifest. The effective configuration is re-read
 * after the write: `adopted` is reported only when it now carries exactly the proposed system,
 * `configured` when another system was configured meanwhile, and anything else throws.
 */
export async function commit(input: Commit) {
  const application = await DesignDetect.contained(input.directory, input.proposal.application)
  if (application === undefined)
    throw new Error(`the detected application ${input.proposal.application} is not a directory inside the project`)
  const file = target(await layers(input.directory, input.global), input.directory)
  return Flock.withLock(
    `design-config:${file}`,
    async () => {
      const current = effective(await layers(input.directory, input.global))
      if (current?.system === undefined) await write(file, input.proposal)
      else if (canonicalJson(current.system) !== canonicalJson(input.proposal.system))
        return { status: "configured" as const }
      const after = effective(await layers(input.directory, input.global))
      if (
        canonicalJson(after?.system) !== canonicalJson(input.proposal.system) ||
        !sameApplication(after?.application, input.proposal.application)
      )
        throw new Error(
          `wrote design.system to ${path.relative(input.directory, file) || file}, but the effective configuration does not carry it; check the design sections of the project's config files`,
        )
      const manifest = await DesignSystem.load(path.join(input.directory, application), {
        refresh: true,
        manifest: true,
        declared: input.proposal.system.paths,
      }).then(
        (loaded) => loaded.manifest,
        (error: unknown) => `${DesignManifest.FILE} not generated: ${String(error)}`,
      )
      await remember(input.state, input.directory, "yes", input.now).catch(() => undefined)
      return { status: "adopted" as const, file, manifest }
    },
    { ...lock, dir: locks(input.state) },
  )
}

// Flow ---------------------------------------------------------------------------------------------

export interface Input<E, R> {
  /** Project directory: where detection starts and where the config is written. */
  readonly directory: string
  /** A design's application, relative to directory, when the caller already knows it. */
  readonly application?: string
  /** File holding the answers, in user state. */
  readonly state: string
  /** Global configuration directory, for verifying the effective configuration after a write. */
  readonly global?: string
  /** Whether `design.system` is already configured. */
  readonly configured: boolean
  /** Asks the question and resolves the chosen option label, or undefined when dismissed. */
  readonly ask: (request: ReturnType<typeof question>) => Effect.Effect<string | undefined, E, R>
  readonly now?: number
  /** Detection time budget in milliseconds; defaults to DesignDetect's. */
  readonly budget?: number
}

/** Questions in flight per project: a second session waits for the first answer instead of asking again. */
const inflight = new Map<string, Promise<Decision>>()

const interview = <E, R>(input: Input<E, R>) =>
  Effect.gen(function* () {
    const now = input.now ?? Date.now()
    const previous = yield* Effect.promise(() => status(input.state, input.directory, now).catch(() => undefined))
    if (previous) return { status: previous } satisfies Decision
    const application =
      input.application === undefined
        ? undefined
        : yield* Effect.promise(() => DesignDetect.contained(input.directory, input.application!))
    if (input.application !== undefined && application === undefined) return { status: "none" } satisfies Decision
    if (yield* Effect.promise(() => cachedNone(input.state, input.directory, application, now).catch(() => false)))
      return { status: "none" } satisfies Decision
    // A failed or partial scan is not evidence of "nothing there", so only a complete one is cached.
    const { proposal, partial } = yield* Effect.promise(() =>
      DesignDetect.scan(input.directory, { application, budget: input.budget }).catch(() => ({
        proposal: undefined,
        partial: true,
      })),
    )
    if (!proposal) {
      if (!partial)
        yield* Effect.promise(() => rememberNone(input.state, input.directory, application, now).catch(() => undefined))
      return { status: "none" } satisfies Decision
    }
    const choice = answer(yield* input.ask(question(proposal)))
    if (choice === "yes") return { status: "yes", proposal } satisfies Decision
    yield* Effect.promise(() => remember(input.state, input.directory, choice, now).catch(() => undefined))
    return { status: choice === "no" ? "declined" : "later", proposal } satisfies Decision
  })

/**
 * Asks once when a design system is detected and nothing is configured, without writing anything.
 * Detection and state failures count as nothing detected.
 */
export const decide = <E, R>(input: Input<E, R>): Effect.Effect<Decision, E, R> =>
  Effect.suspend(() => {
    if (input.configured) return Effect.succeed<Decision>({ status: "configured" })
    const key = `${input.state}\0${path.resolve(input.directory)}`
    const running = inflight.get(key)
    if (running) return Effect.promise(() => running)
    const pending = Promise.withResolvers<Decision>()
    inflight.set(key, pending.promise)
    return interview(input).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          inflight.delete(key)
          pending.resolve(Exit.isSuccess(exit) ? exit.value : { status: "none" })
        }),
      ),
    )
  })

const settle = (input: Commit) =>
  Effect.promise(
    (): Promise<Outcome> =>
      commit(input).then(
        (result) => (result.status === "adopted" ? { ...result, proposal: input.proposal } : { status: "configured" }),
        (error: unknown) => ({
          status: "failed",
          proposal: input.proposal,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
  )

/** Decide, then write an accepted proposal right away: `redcode design`, which has no design to create first. */
export const offer = <E, R>(input: Input<E, R>) =>
  Effect.gen(function* () {
    const decision = yield* decide(input)
    if (decision.status !== "yes") return decision as Outcome
    return yield* settle({ ...input, proposal: decision.proposal })
  })

/** The configuration a proposal amounts to, for a store that adopts it before the config file is written. */
export const adoption = (proposal: DesignDetect.Proposal): ConfigDesign.Effective => ({
  system: Schema.decodeUnknownSync(ConfigDesign.System)(JSON.parse(JSON.stringify(proposal.system))),
  ...(proposal.application !== "." ? { application: proposal.application } : {}),
})

/**
 * Runs a design operation around the proposal: the question comes first so an accepted system
 * applies to this operation, but the config file is written only once the operation succeeded. A
 * failed operation, or a failed write, forgets the adoption again. `adopt` belongs to the calling
 * session: an adoption is visible to that session until it is committed (written and verified),
 * and only then to every session of the location.
 */
export const around = <A, E, R, AE, AR>(
  input: Input<AE, AR> & {
    readonly adopt: (design: ConfigDesign.Effective | undefined, committed?: boolean) => Effect.Effect<void>
  },
  operation: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const decision = yield* decide(input).pipe(Effect.catch(() => Effect.succeed<Decision>({ status: "none" })))
    if (decision.status !== "yes") {
      const value = yield* operation
      return { value, report: report(decision, input.directory) }
    }
    yield* input.adopt(adoption(decision.proposal))
    const value = yield* operation.pipe(Effect.onError(() => input.adopt(undefined)))
    const outcome = yield* settle({ ...input, proposal: decision.proposal })
    yield* outcome.status === "adopted" ? input.adopt(adoption(decision.proposal), true) : input.adopt(undefined)
    return { value, report: report(outcome, input.directory) }
  })

/** The line a tool result carries so the agent knows what the user chose. Empty when nothing was asked. */
export function report(outcome: Outcome | Decision, directory: string) {
  if (outcome.status === "adopted")
    return `Design system: the user adopted the detected design system; wrote design.system to ${path.relative(directory, outcome.file) || outcome.file}${outcome.proposal.application !== "." ? ` for ${outcome.proposal.application}` : ""} (${DesignDetect.summary(outcome.proposal).split("\n").slice(1, -1).join("; ")}). ${outcome.manifest}.`
  if (outcome.status === "failed")
    return `Design system: the user adopted the detected design system, but it could not be saved (${outcome.message}); this design recorded it, later designs will not.`
  if (outcome.status === "declined")
    return "Design system: the user declined the detected design system; do not propose it again and design from the brief."
  if (outcome.status === "later")
    return "Design system: the user postponed adopting the detected design system; it is not configured yet."
  return ""
}

/** design_document {"action":"detect"}: what detection finds and whether it is configured, asking nothing. */
export async function detection(input: {
  readonly directory: string
  readonly application?: string
  readonly global?: string
  readonly state?: string
}) {
  const application =
    input.application === undefined ? undefined : await DesignDetect.contained(input.directory, input.application)
  if (input.application !== undefined && application === undefined)
    return `Design system detection: ${input.application} is not a directory inside the project.`
  const [{ proposal, partial }, design, answered] = await Promise.all([
    DesignDetect.scan(input.directory, { application }).catch(() => ({ proposal: undefined, partial: true })),
    configured(input.directory, input.global).catch(() => undefined),
    input.state ? status(input.state, input.directory).catch(() => undefined) : undefined,
  ])
  const state = design?.system
    ? "design.system is configured; the configured system is what previews use."
    : answered === "dismissed"
      ? "design.system is not configured and the user declined the proposal; do not propose it again."
      : "design.system is not configured; design_document create or refresh asks the user whether to adopt it."
  if (!proposal)
    return partial
      ? `Design system detection: nothing detected before the scan ran out of time; the project may still have one.\n${state}`
      : `Design system detection: nothing detected.\n${state}`
  return `Design system detection (nothing was written):\n${DesignDetect.evidence(proposal)}\n${state}`
}
