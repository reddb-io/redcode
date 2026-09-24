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
import { DesignIdentify } from "./identify"
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

/** How the design system was identified, when identification ran; see DesignIdentify. */
type Identified = { readonly identification?: DesignIdentify.Identification }

export type Decision =
  | ({ readonly status: "configured" | "dismissed" | "snoozed" | "none" } & Identified)
  | ({
      readonly status: "yes" | "later" | "declined"
      readonly proposal: DesignDetect.Proposal
      /** Taken without asking because System One and the scan agree (see Input.auto). */
      readonly automatic?: boolean
    } & Identified)

export type Outcome =
  | ({ readonly status: "configured" | "dismissed" | "snoozed" | "none" } & Identified)
  | ({ readonly status: "later" | "declined"; readonly proposal: DesignDetect.Proposal } & Identified)
  | ({
      readonly status: "adopted"
      readonly proposal: DesignDetect.Proposal
      readonly file: string
      readonly manifest: string
    } & Identified)
  | ({ readonly status: "failed"; readonly proposal: DesignDetect.Proposal; readonly message: string } & Identified)
  | ({ readonly status: "automatic"; readonly proposal: DesignDetect.Proposal } & Identified)

/** The adoption question; an identification adds its one-line result and the reason under the question. */
export const question = (proposal: DesignDetect.Proposal, identification?: DesignIdentify.Identification) => ({
  header: HEADER,
  custom: false,
  question: [
    QUESTION,
    ...(identification ? [DesignIdentify.headline(identification)] : []),
    DesignDetect.summary(proposal),
    ...(identification ? [DesignIdentify.explanation(identification)] : []),
  ].join("\n"),
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
 * Whether a configured system points at paths that no longer exist: any declared root or stylesheet
 * missing makes identification run again, and adopting its result then replaces the configured system.
 */
export async function stale(
  directory: string,
  design: { readonly system?: unknown; readonly application?: string } | undefined,
) {
  // Read leniently: the static configuration loader hands the system over undecoded.
  const system = design?.system as { readonly paths?: unknown; readonly css?: unknown } | undefined
  if (!system || typeof system !== "object") return false
  const declared = [system.paths, system.css].flatMap((list) =>
    Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [],
  )
  const found = await Promise.all(
    declared.map((file) =>
      stat(path.resolve(directory, design?.application ?? ".", file)).then(
        () => true,
        () => false,
      ),
    ),
  )
  return found.includes(false)
}

/**
 * Adds `design.system` (and `design.application` for a package inside a monorepo) to a config file
 * with minimal text edits: other keys, comments and indentation stay as written. A file that already
 * declares `design.system` is left untouched unless `replace` is set (a stale system); an unparsable
 * one is refused.
 */
export async function write(file: string, proposal: DesignDetect.Proposal, replace = false) {
  const exists = await Bun.file(file).exists()
  const before = exists ? await Bun.file(file).text() : "{}\n"
  const errors: ParseError[] = []
  const current = parse(before, errors, { allowTrailingComma: true })
  if (errors.length || (current !== undefined && (typeof current !== "object" || Array.isArray(current))))
    throw new Error(`${path.basename(file)} is not a valid JSON object; add the design section by hand`)
  if ((current as { design?: Design } | undefined)?.design?.system !== undefined && !replace)
    return { file, changed: false }
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
  /** The configured system is stale: Yes replaces it instead of keeping it. */
  readonly replace?: boolean
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
      if (current?.system === undefined || input.replace) await write(file, input.proposal, input.replace)
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
  /**
   * Identifies the design system for the (checked) application in place of the bare heuristic scan:
   * System One or the design agent confirms, corrects or rejects it. See DesignIdentify.
   */
  readonly identify?: (application: string | undefined) => Effect.Effect<DesignIdentify.Identification, never, R>
  /** The configured system is stale (see stale): an adoption replaces it. */
  readonly replace?: boolean
  /**
   * Skip the question when the identification reports agreement: around then adopts the system for
   * the calling session only, without writing the configuration, so a later refresh (auto off) still
   * asks whether to save it.
   */
  readonly auto?: boolean
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
    const identification = input.identify ? yield* input.identify(application) : undefined
    const { proposal, partial } = identification
      ? { proposal: identification.proposal, partial: identification.partial }
      : yield* Effect.promise(() =>
          DesignDetect.scan(input.directory, { application, budget: input.budget }).catch(() => ({
            proposal: undefined,
            partial: true,
          })),
        )
    const identified = identification ? { identification } : {}
    if (!proposal) {
      // An unverified "nothing" may still be corrected by System One or the agent, so it is not cached.
      if (!partial && (identification?.verified ?? true))
        yield* Effect.promise(() => rememberNone(input.state, input.directory, application, now).catch(() => undefined))
      return { status: "none", ...identified } satisfies Decision
    }
    if (input.auto && identification?.agreement)
      return { status: "yes", proposal, automatic: true, ...identified } satisfies Decision
    const choice = answer(yield* input.ask(question(proposal, identification)))
    if (choice === "yes") return { status: "yes", proposal, ...identified } satisfies Decision
    yield* Effect.promise(() => remember(input.state, input.directory, choice, now).catch(() => undefined))
    return { status: choice === "no" ? "declined" : "later", proposal, ...identified } satisfies Decision
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

const settle = (input: Commit, identification?: DesignIdentify.Identification) =>
  Effect.promise(
    (): Promise<Outcome> =>
      commit(input).then(
        (result) =>
          result.status === "adopted"
            ? { ...result, proposal: input.proposal, ...(identification ? { identification } : {}) }
            : { status: "configured" },
        (error: unknown) => ({
          status: "failed",
          proposal: input.proposal,
          message: error instanceof Error ? error.message : String(error),
          ...(identification ? { identification } : {}),
        }),
      ),
  )

/** Decide, then write an accepted proposal right away: `redcode design`, which has no design to create first. */
export const offer = <E, R>(input: Input<E, R>) =>
  Effect.gen(function* () {
    const decision = yield* decide(input)
    if (decision.status !== "yes") return decision as Outcome
    return yield* settle({ ...input, proposal: decision.proposal }, decision.identification)
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
      return { value, report: report(decision, input.directory), decision }
    }
    yield* input.adopt(adoption(decision.proposal))
    const value = yield* operation.pipe(Effect.onError(() => input.adopt(undefined)))
    if (decision.automatic)
      return {
        value,
        report: report({ ...decision, status: "automatic" }, input.directory),
        decision,
      }
    const outcome = yield* settle({ ...input, proposal: decision.proposal }, decision.identification)
    yield* outcome.status === "adopted" ? input.adopt(adoption(decision.proposal), true) : input.adopt(undefined)
    return { value, report: report(outcome, input.directory), decision }
  })

/**
 * The line a tool result carries so the agent knows what the user chose, led by the identification's
 * one-line result when identification ran. Empty when nothing was identified or asked.
 */
export function report(outcome: Outcome | Decision, directory: string) {
  const line = reported(outcome, directory)
  const identification = outcome.identification
  if (!identification) return line
  if (outcome.status === "none")
    return `${DesignIdentify.headline(identification)}; nothing to adopt, so design from the brief.`
  return [DesignIdentify.headline(identification), line].filter(Boolean).join(". ")
}

function reported(outcome: Outcome | Decision, directory: string) {
  if (outcome.status === "automatic")
    return "System One and the scan agree, so this design uses it without asking; it is not saved to the configuration. design_document refresh asks whether to save it, and the user can change it there"
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

/** The design-system part of the design chip for a decision: what this design uses. */
export function chip(decision: Decision) {
  if (decision.status === "configured") return "DS: configured"
  if (decision.status === "dismissed" || decision.status === "declined") return "DS: declined"
  if (decision.identification) return DesignIdentify.chip(decision.identification)
  return decision.status === "yes" ? "DS: detected" : "DS: none"
}

/** design_document {"action":"detect"}: what detection finds and whether it is configured, asking nothing. */
export async function detection(input: {
  readonly directory: string
  readonly application?: string
  readonly global?: string
  readonly state?: string
  /** Appends the evidence pack and asks the design agent for its conclusion (single reasoning). */
  readonly pack?: boolean
}) {
  const application =
    input.application === undefined ? undefined : await DesignDetect.contained(input.directory, input.application)
  if (input.application !== undefined && application === undefined)
    return `Design system detection: ${input.application} is not a directory inside the project.`
  const [{ proposal, partial }, design, answered, pack] = await Promise.all([
    DesignDetect.scan(input.directory, { application }).catch(() => ({ proposal: undefined, partial: true })),
    configured(input.directory, input.global).catch(() => undefined),
    input.state ? status(input.state, input.directory).catch(() => undefined) : undefined,
    input.pack ? DesignIdentify.collect(input.directory).catch(() => undefined) : undefined,
  ])
  const evidence = pack ? `\n${DesignIdentify.render(pack)}\n${DesignIdentify.INSTRUCTIONS}` : ""
  const state = design?.system
    ? "design.system is configured; the configured system is what previews use."
    : answered === "dismissed"
      ? "design.system is not configured and the user declined the proposal; do not propose it again."
      : "design.system is not configured; design_document create or refresh asks the user whether to adopt it."
  if (!proposal)
    return partial
      ? `Design system detection: nothing detected before the scan ran out of time; the project may still have one.\n${state}${evidence}`
      : `Design system detection: nothing detected by the heuristic.\n${state}${evidence}`
  return `Design system detection (nothing was written):\n${DesignDetect.evidence(proposal)}\n${state}${evidence}`
}
