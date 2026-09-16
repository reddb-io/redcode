export * as DesignRounds from "./rounds"

import { Design } from "@reddb-io/redcode-schema/design"

/**
 * Feedback rounds and note statuses, kept on the design document.
 *
 * A round is the set of notes received since the last revision the agent published after them:
 * review messages that arrive while no revision answered the previous notes join the open round;
 * the first publish after them closes it, and the next message opens the following round. Every
 * note is named by its feedback message and its 1-based number in that message, the numbering the
 * rendered `<design-review>` uses. Pure over the document, so both runtimes and the store share it.
 */

type Rounds = Pick<Design.Info, "rounds" | "notes">

/** The most recent round, or undefined before the first review message. */
export const latest = (document: Rounds) => document.rounds?.at(-1)

/** The round a message admitted now would join: the open one, or the number after the last. */
export function next(document: Rounds) {
  const last = latest(document)
  return last && !last.published ? last.number : (last?.number ?? 0) + 1
}

/** Notes of one round, in arrival order. */
export const notes = (document: Rounds, round: number) => (document.notes ?? []).filter((note) => note.round === round)

/** Notes of the latest round still awaiting an outcome. */
export function open(document: Rounds) {
  const last = latest(document)
  return last ? notes(document, last.number).filter((note) => note.status === "open") : []
}

/**
 * Record an admitted review message: its notes open in the current round, or a new one when the
 * previous round was already answered by a revision. Admitting the same message twice changes nothing.
 */
export function admit(document: Rounds, feedback: Design.Feedback, now = Date.now()): Rounds {
  if (document.rounds?.some((round) => round.feedback.includes(feedback.id))) return document
  const items = Design.notesOf(feedback)
  if (!items.length) return document
  const last = latest(document)
  const joins = last && !last.published
  const round: Design.Round = joins
    ? { ...last, feedback: [...last.feedback, feedback.id] }
    : { number: (last?.number ?? 0) + 1, opened: now, revision: feedback.revision, feedback: [feedback.id] }
  const added: Design.Note[] = items.map((item, position) => ({
    feedback: feedback.id,
    index: position + 1,
    round: round.number,
    item,
    status: "open",
    updated: now,
  }))
  return {
    rounds: joins ? [...(document.rounds ?? []).slice(0, -1), round] : [...(document.rounds ?? []), round],
    notes: [...(document.notes ?? []), ...added],
  }
}

/** A published revision answers the open round: it closes to new notes and records that revision. */
export function published(document: Rounds, revision: string): Rounds {
  const last = latest(document)
  if (!last || last.published) return document
  return { ...document, rounds: [...(document.rounds ?? []).slice(0, -1), { ...last, published: revision }] }
}

const same = (note: { feedback: string; index: number }, other: { feedback: string; index: number }) =>
  note.feedback === other.feedback && note.index === other.index

/** The verify job's observation of one note, when the job verified it. */
export const observed = (job: Design.Job | undefined, note: { feedback: string; index: number }) =>
  job?.verify?.notes.find((item) => same(item, note))

/**
 * Apply status updates: each names an existing note; a cited job must be a completed verify job of
 * this design, whose observation of the note (capture and findings) is copied into the evidence.
 * Returns the merged notes or the problem with the first update that cannot be applied.
 */
export function apply(
  document: Rounds,
  updates: ReadonlyArray<Design.NoteUpdate>,
  jobs: ReadonlyArray<Design.Job>,
  now = Date.now(),
): { notes: Design.Note[] } | { problem: string } {
  const current = [...(document.notes ?? [])]
  for (const update of updates) {
    const position = current.findIndex((note) => same(note, update))
    if (position < 0) return { problem: `Unknown note ${update.feedback} #${update.index}. ${describeNotes(current)}` }
    const job = update.evidence ? jobs.find((item) => item.id === update.evidence!.job) : undefined
    if (update.evidence && (!job || job.input.format !== "verify" || job.status !== "completed" || !job.verify))
      return {
        problem: `Evidence job ${update.evidence.job} is not a completed verify job of this design. ${describeJobs(jobs)}`,
      }
    const seen = observed(job, update)
    const { reason: previousReason, evidence: previousEvidence, ...before } = current[position]
    // A repeated status keeps its reason and evidence unless the update replaces them; a new status starts over.
    const kept = before.status === update.status
    const reason = update.reason?.trim() || (kept ? previousReason : undefined)
    const evidence = job
      ? {
          job: job.id,
          revision: job.input.revision,
          ...(seen?.after ? { capture: seen.after } : {}),
          ...(seen ? { findings: seen.findings } : {}),
        }
      : kept
        ? previousEvidence
        : undefined
    current[position] = {
      ...before,
      status: update.status,
      updated: now,
      ...(reason ? { reason } : {}),
      ...(evidence ? { evidence } : {}),
    }
  }
  return { notes: current }
}

/** The verify jobs of a design, newest first, as a refusal or report names them. */
export function describeJobs(jobs: ReadonlyArray<Design.Job>, limit = 5) {
  const recent = jobs
    .filter((job) => job.input.format === "verify")
    .toSorted((a, b) => (b.finished ?? b.created) - (a.finished ?? a.created))
    .slice(0, limit)
  if (!recent.length) return "Verify jobs: none. Start one with design_export format verify and poll design_jobs."
  return `Recent verify jobs (newest first): ${recent
    .map((job) => {
      const found =
        job.status === "completed" && job.verify
          ? job.verify.notes.filter((note) => note.found && !note.blocking).length
          : undefined
      return `${job.id} (revision ${job.input.revision}, round ${job.verify?.round ?? job.input.round ?? "latest"}, ${job.status}${found !== undefined ? `, ${found} of ${job.verify!.notes.length} notes found without blocking findings` : ""})`
    })
    .join("; ")}.`
}

/** Up to ten notes, for an error that has to name the ones the agent may update. */
export function describeNotes(list: ReadonlyArray<Design.Note>, limit = 10) {
  if (!list.length) return "Notes: none recorded."
  return `Notes: ${list
    .slice(-limit)
    .map((note) => `${note.feedback} #${note.index} (round ${note.round}, ${note.status})`)
    .join(", ")}${list.length > limit ? ` and ${list.length - limit} earlier` : ""}.`
}

/** One line per round for tool output: how many notes are in each state. */
export function summary(document: Rounds) {
  const rounds = document.rounds ?? []
  if (!rounds.length) return "none"
  return rounds
    .map((round) => {
      const counts = new Map<Design.NoteStatus, number>()
      for (const note of notes(document, round.number)) counts.set(note.status, (counts.get(note.status) ?? 0) + 1)
      const parts = [...counts].map(([status, count]) => `${count} ${status}`)
      return `round ${round.number} (${round.published ? `answered by ${round.published}` : "awaiting a revision"}): ${parts.join(", ") || "no notes"}`
    })
    .join("; ")
}

/** The label a note is listed under: the element as the reviewer saw it, else its selector. */
export const label = (note: Pick<Design.Note, "item">) => (note.item.label || note.item.target).trim()

/** The verdict the review page shows for one verified note. */
export function verdict(note: Pick<Design.VerifyNote, "found" | "blocking" | "findings">) {
  if (!note.found || note.blocking) return "fail" as const
  return note.findings.length ? ("warn" as const) : ("pass" as const)
}
