/**
 * Where a Design review's feedback rounds stand, as every surface shows them: the review page, the terminal
 * sidebar and the app's Design tab. Pure over the design document the server lists (its rounds, notes, latest
 * revision and pending end) and, when a surface has it, the design's revision list; nothing is fetched or
 * stored. The shapes are structural so the server's schema types and the generated client types both fit.
 */

export type NoteStatus = "open" | "resolved" | "partial" | "unresolved" | "accepted"

/**
 * How far a round has come, in the review page's progress vocabulary (`RoundStage` in the page's loading
 * module), as far as the document alone tells it: notes received, some marked addressed, a revision the agent
 * published answered the round, every note has an outcome. Live facts (verify jobs, the agent's activity) are
 * the page's to add.
 */
export type RoundStage = "received" | "fixing" | "published" | "recorded"

export interface NoteShape {
  readonly round: number
  readonly status: NoteStatus
  readonly addressed?: unknown
  readonly by?: "agent" | "reviewer"
}

export interface DesignShape<Note extends NoteShape> {
  readonly revision: string | null
  readonly ended?: boolean
  readonly endRequested?: boolean
  readonly rounds?: ReadonlyArray<{ readonly number: number; readonly revision: string; readonly published?: string }>
  readonly notes?: ReadonlyArray<Note>
}

/** A revision and its number in the design's history (R7); `ordinal` is 0 when the revision list lacks it. */
export interface RevisionRef {
  readonly id: string
  readonly ordinal: number
}

export interface RoundSummary<Note extends NoteShape> {
  readonly number: number
  readonly stage: RoundStage
  /** The revision under review when the round opened. */
  readonly opened: RevisionRef
  /** The revision the agent published as the round's answer, once there is one. */
  readonly published?: RevisionRef
  readonly notes: ReadonlyArray<Note>
  readonly total: number
  /** Notes still without an outcome. */
  readonly open: number
  /** Notes the agent marked addressed or that have an outcome (an outcome keeps the mark). */
  readonly addressed: number
  /** Notes with an outcome. */
  readonly recorded: number
  readonly resolved: number
  readonly partial: number
  readonly unresolved: number
  readonly accepted: number
  /** Outcomes the reviewer recorded from the review page (always unresolved or accepted). */
  readonly reviewer: number
}

/**
 * The rounds of one design, oldest first, with the views the surfaces share: the rounds that still have a
 * note without an outcome (newest first, the work left), and the newest round once every note of it has an
 * outcome, so partial and unresolved outcomes stay visible after the round is done.
 */
export function designRoundSummary<Note extends NoteShape>(
  design: DesignShape<Note>,
  revisions?: ReadonlyArray<{ readonly id: string }>,
) {
  const ref = (id: string): RevisionRef => ({ id, ordinal: revisionOrdinal(revisions ?? [], id) })
  const rounds = (design.rounds ?? []).map((round): RoundSummary<Note> => {
    const notes = (design.notes ?? []).filter((note) => note.round === round.number)
    const count = (test: (note: Note) => boolean) => notes.filter(test).length
    const addressed = count((note) => note.status !== "open" || !!note.addressed)
    const recorded = count((note) => note.status !== "open")
    return {
      number: round.number,
      stage: round.published
        ? recorded === notes.length
          ? "recorded"
          : "published"
        : addressed > 0
          ? "fixing"
          : "received",
      opened: ref(round.revision),
      ...(round.published ? { published: ref(round.published) } : {}),
      notes,
      total: notes.length,
      open: notes.length - recorded,
      addressed,
      recorded,
      resolved: count((note) => note.status === "resolved"),
      partial: count((note) => note.status === "partial"),
      unresolved: count((note) => note.status === "unresolved"),
      accepted: count((note) => note.status === "accepted"),
      reviewer: count((note) => note.status !== "open" && note.by === "reviewer"),
    }
  })
  const latest = rounds.at(-1)
  return {
    rounds,
    latest,
    pending: rounds.filter((round) => round.open > 0).toReversed(),
    answered: latest && latest.total > 0 && latest.open === 0 ? latest : undefined,
    /** Notes without an outcome across every round: the rule approval and ending the review use. */
    open: rounds.reduce((sum, round) => sum + round.open, 0),
    revision: design.revision ? ref(design.revision) : undefined,
    /** The reviewer sent Send & end with notes: the review ends by itself once every note has an outcome. */
    endRequested: !design.ended && !!design.endRequested,
    ended: !!design.ended,
  }
}

export type DesignRoundSummary<Note extends NoteShape> = ReturnType<typeof designRoundSummary<Note>>

/**
 * A revision's number in its design's history (R7): its position in the immutable revision list the server
 * returns newest first, so no counter is stored. 0 for a revision the list does not hold.
 */
export function revisionOrdinal(revisions: ReadonlyArray<{ readonly id: string }>, id: string) {
  const index = revisions.findIndex((revision) => revision.id === id)
  return index < 0 ? 0 : revisions.length - index
}

/**
 * The revision ordinals the agent's own tool results announced in a transcript: `design_preview` and a
 * restoring `design_history` record `{ revision, ordinal }` in their metadata. Lets a transcript card name the
 * revision (R7) without fetching the revision list; revisions published from the review page are absent.
 */
export function announcedOrdinals(
  tools: Iterable<{
    readonly name: string
    readonly state: { readonly status: string; readonly metadata?: Readonly<Record<string, unknown>> }
  }>,
) {
  return new Map(
    [...tools].flatMap((tool) => {
      if (tool.name !== "design_preview" && tool.name !== "design_history") return []
      if (tool.state.status !== "completed") return []
      const revision = tool.state.metadata?.revision
      const ordinal = tool.state.metadata?.ordinal
      return typeof revision === "string" && typeof ordinal === "number" && Number.isSafeInteger(ordinal)
        ? [[revision, ordinal] as const]
        : []
    }),
  )
}

/** The outcome counts of a round as one phrase, zero counts left out: `12 resolved · 1 partial · 1 unresolved`. */
export function outcomeTally(round: Pick<RoundSummary<NoteShape>, "resolved" | "partial" | "unresolved" | "accepted">) {
  return (["resolved", "partial", "unresolved", "accepted"] as const)
    .filter((status) => round[status] > 0)
    .map((status) => `${round[status]} ${status}`)
    .join(" · ")
}
