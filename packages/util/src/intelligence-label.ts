export * as IntelligenceLabel from "./intelligence-label.js"

/**
 * What the S1 / S2 indicator says about a session, in the same words in every surface. Dual reasoning lets System
 * One (S1) evaluate System Two (S2); the indicator speaks only when something deserves attention: the roles are not
 * set up, S1 only observes, or S1's latest evaluation could not vouch for the answer.
 */

/** What the session's latest dual evaluation says, when it is worth saying. */
export type Outcome = "unavailable" | "inconclusive" | "needs_revision"

/**
 * - `offline`: the reasoning status could not be read.
 * - `setup`: the reasoning roles were never set up; the indicator opens the setup.
 * - `observing`: S1 records recommendations without intervening.
 * - `unavailable`: S1 could not be reached for the latest evaluation.
 * - `unsure`: S1 could not decide on the latest answer.
 * - `flagged`: S1 asked for the latest answer to be revised.
 */
export type State = "offline" | "setup" | "observing" | "unavailable" | "unsure" | "flagged"

/** The indicator's words, the same in the TUI and the desktop. */
export const labels: Record<State, string> = {
  offline: "S1/S2 offline",
  setup: "S1/S2 setup",
  observing: "S1 observing",
  unavailable: "S1 unavailable",
  unsure: "S1 unsure",
  flagged: "S1 flagged answer",
}

/**
 * The latest dual evaluation's outcome, in words that do not read as an outage unless S1 truly was unreachable.
 * Nothing outside dual mode: observation never intervenes, and single mode has no S1.
 */
export function outcome(input: {
  readonly mode: string | undefined
  /** Reading the session's evaluations failed. */
  readonly historyFailed: boolean
  /** The latest evaluation's decision, if any. */
  readonly decision: string | undefined
}): Outcome | undefined {
  if (input.mode !== "dual") return undefined
  if (input.historyFailed) return "unavailable"
  if (input.decision === "unavailable" || input.decision === "inconclusive" || input.decision === "needs_revision")
    return input.decision
  return undefined
}

/**
 * What the indicator says, or nothing. `onboarding` is the roles' setup state, undefined while the status loads, which
 * says nothing yet.
 */
export function state(input: {
  /** Reading the reasoning status failed. */
  readonly failed: boolean
  readonly onboarding: string | undefined
  readonly mode: string | undefined
  readonly outcome: Outcome | undefined
}): State | undefined {
  if (input.failed) return "offline"
  if (input.onboarding === undefined) return undefined
  if (input.onboarding !== "completed") return "setup"
  if (input.mode === "observe") return "observing"
  if (input.outcome === "unavailable") return "unavailable"
  if (input.outcome === "inconclusive") return "unsure"
  if (input.outcome === "needs_revision") return "flagged"
  return undefined
}

/** Only a real outage takes the warning tone: a flagged or unsure answer is S1 working, not S1 broken. */
export function tone(input: { readonly failed: boolean; readonly outcome: Outcome | undefined }) {
  if (input.failed || input.outcome === "unavailable") return "warning" as const
  if (input.outcome) return "info" as const
  return "muted" as const
}

/** The gate and classification answers the scored label reads; `Intelligence.Answer` satisfies it. */
export interface Answerish {
  readonly type: string
  readonly noul?: number
  readonly confidence?: number
}

/** How sure the latest evaluation speaks: the weakest answer's certainty — one minus the worst gate
 *  probability, or the lowest answer confidence. Undefined when the answers hold nothing to read. */
export function sureness(answers: Readonly<Record<string, Answerish>> | undefined): number | undefined {
  const values = Object.values(answers ?? {})
    .map((answer) =>
      answer.type === "noul" ? (answer.noul === undefined ? undefined : 1 - answer.noul) : answer.confidence,
    )
    .filter((value): value is number => value !== undefined)
  return values.length ? Math.min(...values) : undefined
}

/** The scored words for an inconclusive verdict: the margin S1 actually had, instead of a bare
 *  "unsure". The same words in the TUI and the desktop. */
export function scored(state: State, sureness: number | undefined): string {
  if (state === "unsure" && sureness !== undefined) return `S1 ${Math.round(sureness * 100)}% sure`
  return labels[state]
}

/**
 * The workspace state an evaluation read, as one short line per subject: what the review actually saw,
 * shown beside its verdict. Unknown shapes stay quiet instead of guessing.
 */
export function readDigest(read: unknown): string | undefined {
  if (!read || typeof read !== "object" || Array.isArray(read)) return undefined
  const parts = Object.entries(read as Record<string, unknown>).flatMap(([subject, slice]): string[] => {
    if (typeof slice === "string") return [`${subject}: ${slice}`]
    if (!slice || typeof slice !== "object" || Array.isArray(slice)) return []
    const record = slice as Record<string, unknown>
    const bits: string[] = []
    if (Array.isArray(record.files)) bits.push(`${record.files.length} files`)
    if (record.todos && typeof record.todos === "object" && !Array.isArray(record.todos)) {
      const counts = Object.entries(record.todos as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0,
      )
      bits.push(counts.length ? counts.map(([status, count]) => `${count} ${status}`).join(", ") : "no tasks")
    }
    if (typeof record.goal === "string") bits.push(`goal ${record.goal}`)
    return bits.length ? [`${subject}: ${bits.join(", ")}`] : []
  })
  return parts.length ? parts.join(" · ") : undefined
}

const transports: Record<string, string> = {
  "opencode-zen": "OpenCode Zen",
  openrouter: "OpenRouter",
  typesafe: "TypeSafe",
  "red-router": "RedRouter",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  vercel: "Vercel",
  vivgrid: "Vivgrid",
  "nano-gpt": "NanoGPT",
}

/** The S1 evaluator's transport as people know it, such as `OpenRouter`; an unknown transport as written. */
export function transportName(transport: string) {
  return transports[transport] ?? transport
}

/** The S1 evaluator's model without its vendor path, with the JEV family named as such. */
export function modelName(model: string) {
  return (model.split("/").at(-1) ?? model).replace(/^jev[-_ ]/i, "JEV ")
}
