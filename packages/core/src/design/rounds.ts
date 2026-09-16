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

/** Notes of every round still awaiting an outcome; an older round's notes count until they are recorded. */
export const open = (document: Rounds) => (document.notes ?? []).filter((note) => note.status === "open")

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
  by: Design.NoteRecorder = "agent",
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
    if (job && !seen)
      return {
        problem: `Evidence job ${job.id} did not cover note ${update.feedback} #${update.index} (it verified round ${job.verify!.round}). ${describeJobs(jobs)}`,
      }
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
    const { by: _previousBy, ...rest } = before
    current[position] = {
      ...rest,
      status: update.status,
      by,
      updated: now,
      ...(reason ? { reason } : {}),
      ...(evidence ? { evidence } : {}),
    }
  }
  return { notes: current }
}

/** Prefix of every refusal the status gate issues, so runtimes and logs recognise it. */
export const REFUSED = "Note status refused:"

/**
 * The soft gate on note statuses, judged before an update is applied. `resolved` needs a completed
 * verify job on the design's current revision that found the note's element with no blocking
 * finding; `partial` needs such a job (whatever it saw) and a reason; `unresolved` and `accepted`
 * need a reason. A refusal names the recent verify jobs, as the todo evidence gate names callIDs.
 */
export function gate(
  document: Rounds & { readonly revision: string | null },
  update: Design.NoteUpdate,
  jobs: ReadonlyArray<Design.Job>,
  by: Design.NoteRecorder = "agent",
): string | undefined {
  const name = `${update.feedback} #${update.index}`
  const refuse = (text: string) => `${REFUSED} ${text} ${describeJobs(jobs)}`
  const reason = update.reason?.trim()
  // The reviewer's escape hatch: a person can close a note the agent cannot verify, but only as
  // accepted or unresolved, with a reason, and the record says who did it.
  if (by === "reviewer" && update.status !== "unresolved" && update.status !== "accepted")
    return `${REFUSED} the reviewer records a note as accepted or unresolved; resolved and partial come from the agent's verify.`
  if (update.status === "unresolved" || update.status === "accepted")
    return reason
      ? undefined
      : `${REFUSED} ${update.status} for ${name} needs a reason saying what stays open and why; the reviewer reads it.`
  if (!update.evidence)
    return refuse(
      `${update.status} for ${name} needs evidence: run one verify for the round on the current revision (design_export format verify, poll design_jobs) and cite it as {"evidence":{"job":"<verify job id>"}}.`,
    )
  const job = jobs.find((item) => item.id === update.evidence!.job)
  if (!job || job.input.format !== "verify" || job.status !== "completed" || !job.verify)
    return refuse(`Evidence job ${update.evidence.job} is not a completed verify job of this design.`)
  if (job.input.revision !== document.revision)
    return refuse(
      `Evidence job ${job.id} verified ${job.input.revision}, not the current revision ${document.revision ?? "(unpublished)"}. Run one verify on the current revision and cite it.`,
    )
  const seen = observed(job, update)
  if (!seen) {
    const round = (document.notes ?? []).find((note) => same(note, update))?.round
    return refuse(
      `Evidence job ${job.id} verified round ${job.verify.round}, not ${name}${round === undefined ? "" : ` (round ${round})`}. Run design_export {"revision":"${document.revision}","format":"verify"${round === undefined ? "" : `,"round":${round}`}} and cite that job.`,
    )
  }
  if (update.status === "partial")
    return reason ? undefined : `${REFUSED} partial for ${name} needs a reason saying what still differs from the note.`
  if (!seen.found)
    return refuse(
      `${name} cannot be resolved: ${job.id} did not find its element in ${job.input.revision} (${seen.reason}). Record it unresolved or accepted with a reason, or restore the element and verify again.`,
    )
  if (seen.blocking)
    return refuse(
      `${name} cannot be resolved: ${job.id} found blocking findings for it (${seen.findings.filter((finding) => finding.startsWith("error ·")).join("; ") || seen.reason}). Fix them, publish, verify again, or record partial with a reason.`,
    )
  return undefined
}

/**
 * Why the review cannot end or be approved now: notes of the latest round still awaiting an outcome.
 * Undefined when every note has one.
 */
export function blocking(document: Rounds) {
  const pending = open(document)
  if (!pending.length) return undefined
  const rounds = [...new Set(pending.map((note) => note.round))].toSorted((a, b) => a - b)
  const describe = (round: number, position: number) => {
    const items = pending.filter((note) => note.round === round)
    return `${position === 0 ? "Round" : "round"} ${round} has ${items.length} note${items.length === 1 ? "" : "s"} without a recorded outcome: ${items
      .slice(0, 8)
      .map((note) => `${note.feedback} #${note.index} (${label(note)})`)
      .join(", ")}${items.length > 8 ? ` and ${items.length - 8} more` : ""}`
  }
  return `${rounds.map(describe).join("; ")}. Fix them, publish one revision, run one verify per round (design_export format verify with round set) and record each note with design_document update notes; unresolved or accepted with a reason are allowed.`
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
