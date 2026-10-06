export * as DesignRounds from "./rounds.js"

import { Design } from "@opencode/schema/design"
import { DesignApproval } from "./approval.js"
import { DesignVerify } from "./verify.js"

/**
 * Feedback rounds and note statuses, kept on the design document.
 *
 * A round is the set of notes received since the last revision the agent published after them:
 * review messages that arrive while no revision answered the previous notes join the open round;
 * the agent's first publish after them closes it (a revision published from the review page does
 * not), and the next message opens the following round. Every
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

/** The target of a note on the whole page, as the review page names one. */
export const PAGE = "page"

/**
 * Record a chat message the user typed that asks for changes to the published prototype as one note on
 * the whole page, `<message id> #1`, marked `source: "message"`, joining the open round or opening a new
 * one as `admit` does for a review message. The note keeps the user's words whole. A message already in a
 * round, a blank one, or a design with no published revision changes nothing, so a retry records one note.
 * `revision` is the one the user saw when the message arrived, which a verify compares the element against;
 * the classification can land after the agent published again. Without one, the current revision.
 */
export function implicit(
  document: Rounds & Pick<Design.Info, "revision">,
  message: { readonly id: string; readonly text: string; readonly revision?: string },
  now = Date.now(),
): Rounds {
  if (!document.revision || !message.text.trim()) return document
  const origin = message.revision ?? document.revision
  if (
    document.rounds?.some((round) => round.feedback.includes(message.id)) ||
    document.notes?.some((note) => note.feedback === message.id)
  )
    return document
  const last = latest(document)
  const joins = last && !last.published
  const round: Design.Round = joins
    ? { ...last, feedback: [...last.feedback, message.id] }
    : { number: (last?.number ?? 0) + 1, opened: now, revision: origin, feedback: [message.id] }
  const note: Design.Note = {
    feedback: message.id,
    index: 1,
    round: round.number,
    item: { target: PAGE, text: message.text, revision: origin },
    status: "open",
    source: "message",
    updated: now,
  }
  return {
    rounds: joins ? [...(document.rounds ?? []).slice(0, -1), round] : [...(document.rounds ?? []), round],
    notes: [...(document.notes ?? []), note],
  }
}

/**
 * A revision the agent published answers the open round: it closes to new notes and records that
 * revision. Revisions published from the review page never call this.
 */
export function published(document: Rounds, revision: string): Rounds {
  const last = latest(document)
  if (!last || last.published) return document
  return { ...document, rounds: [...(document.rounds ?? []).slice(0, -1), { ...last, published: revision }] }
}

/** How many notes one listing of notes quotes, and the code points of each note's text it keeps. */
export const LISTED = { limit: 30, clip: 200 } as const

/** Notes of the open round (the latest, not yet answered) with neither an addressed mark nor an outcome. */
export function unaddressed(document: Rounds) {
  const last = latest(document)
  if (!last || last.published) return []
  return notes(document, last.number).filter((note) => note.status === "open" && !note.addressed)
}

/**
 * Why the agent may not publish now, or undefined when it may: a publish answers the open round, so
 * every note of that round needs an addressed mark or an outcome first. Quotes those notes and names
 * the two ways out.
 */
export function unanswerable(document: Rounds) {
  const left = unaddressed(document)
  if (!left.length) return undefined
  return [
    `Publish refused: this revision would answer feedback round ${latest(document)!.number}, and ${left.length} of its notes have neither an addressed mark nor an outcome:`,
    DesignApproval.worklist(left, LISTED),
    'Fix each of them, then mark it with design_document update {"addressed":[{"feedback":"<feedback>","index":<n>,"summary":"<what you changed>"}]}. For a note you will not change, record it instead: design_document update {"notes":[{"feedback":"<feedback>","index":<n>,"status":"unresolved|accepted","reason":"<why>"}]}. Then call design_preview again.',
  ].join("\n")
}

/** What one update did to the addressed marks it carried; told to the agent, nothing here is stored. */
export interface Ticked {
  readonly applied: number
  /** Marks on notes that already have an outcome: the outcome stands. */
  readonly ignored: ReadonlyArray<Marked>
  readonly refused: ReadonlyArray<Marked>
  /** The lists the refusals point at, each once. */
  readonly context: ReadonlyArray<string>
}

/**
 * Apply addressed marks one by one: a mark names an existing note, sets `addressed` on it while it is
 * open and keeps its status. A repeated mark replaces the summary. A note with an outcome ignores the
 * mark, and an unknown note refuses only its own mark. No evidence is needed: a mark is the agent's
 * statement, not an outcome.
 */
export function tick(document: Rounds, claims: ReadonlyArray<Design.NoteClaim>, now = Date.now()) {
  const current = [...(document.notes ?? [])]
  const fates = claims.map((claim): { claim: Design.NoteClaim; refused?: string; ignored?: string } => {
    const name = `${claim.feedback} #${claim.index}`
    const position = current.findIndex((note) => same(note, claim))
    if (position < 0) return { claim, refused: `Unknown note ${name}.` }
    const summary = claim.summary.trim()
    if (!summary) return { claim, refused: `The addressed mark for ${name} needs a summary of what changed.` }
    const note = current[position]
    if (note.status !== "open")
      return { claim, ignored: `already recorded ${note.status}; the outcome stands and the mark was ignored.` }
    current[position] = { ...note, addressed: { summary, at: now }, updated: now }
    return { claim }
  })
  const marked = (reason: (fate: (typeof fates)[number]) => string | undefined) =>
    fates.flatMap((fate) => {
      const text = reason(fate)
      return text ? [{ feedback: fate.claim.feedback, index: fate.claim.index, reason: text }] : []
    })
  const refused = marked((fate) => fate.refused)
  const ticked: Ticked = {
    applied: fates.filter((fate) => !fate.refused && !fate.ignored).length,
    ignored: marked((fate) => fate.ignored),
    refused,
    context: refused.some((item) => item.reason.startsWith("Unknown note")) ? [describeNotes(current)] : [],
  }
  return { notes: current, ticked }
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
 * The gate over every status of one update, each judged on its own, so a refusal keeps out only the
 * status it names. `see` names the lists the refusals point at (`describeNotes`, `describeJobs`), for
 * the caller to give once for the update instead of once per refusal.
 */
export function triage(
  document: Rounds & { readonly revision: string | null },
  updates: ReadonlyArray<Design.NoteUpdate>,
  jobs: ReadonlyArray<Design.Job>,
  by: Design.NoteRecorder = "agent",
) {
  const checked = updates.map((update) => ({ update, refusal: refusal(document, update, jobs, by) }))
  return {
    checked: checked.map((item) => ({ update: item.update, refusal: item.refusal?.text })),
    see: (["notes", "jobs"] as const).filter((list) => checked.some((item) => item.refusal?.see === list)),
  }
}

/**
 * The soft gate on one note status, judged before an update is applied: why the status cannot be
 * recorded, or undefined when it can. The update must name a recorded note. `resolved` needs a
 * completed verify job on the design's current revision that found the note's element with no blocking
 * finding and, when that job measured the element's delta, some change in it or a scenario that verified
 * the behavior (page-level notes are not measured); `partial` needs such a job (whatever it saw) and a reason; `unresolved` and `accepted` need
 * a reason, and a verify job only when they cite one. `see` names the list that tells the agent what
 * to cite instead (the recorded notes or the recent verify jobs), as the todo evidence gate names
 * callIDs.
 */
function refusal(
  document: Rounds & { readonly revision: string | null },
  update: Design.NoteUpdate,
  jobs: ReadonlyArray<Design.Job>,
  by: Design.NoteRecorder,
): { readonly text: string; readonly see?: "jobs" | "notes" } | undefined {
  const name = `${update.feedback} #${update.index}`
  const refuse = (text: string) => ({ text: `${REFUSED} ${text}`, see: "jobs" as const })
  const reason = update.reason?.trim()
  // Checked before anything else: a mistyped id is not an evidence problem, and saying so would
  // send the agent to verify again.
  const note = (document.notes ?? []).find((item) => same(item, update))
  if (!note) return { text: `Unknown note ${name}.`, see: "notes" }
  // The reviewer's escape hatch: a person can close a note the agent cannot verify, but only as
  // accepted or unresolved, with a reason, and the record says who did it.
  if (by === "reviewer" && update.status !== "unresolved" && update.status !== "accepted")
    return {
      text: `${REFUSED} the reviewer records a note as accepted or unresolved; resolved and partial come from the agent's verify.`,
    }
  const claimed = isClaim(update)
  if (!claimed && !reason)
    return {
      text: `${REFUSED} ${update.status} for ${name} needs a reason saying what stays open and why; the reviewer reads it.`,
    }
  if (!update.evidence)
    return claimed
      ? refuse(
          `${update.status} for ${name} needs evidence: run one verify for the round on the current revision (design_export format verify, wait for its native monitor to complete) and cite it as {"evidence":{"job":"<verify job id>"}}.`,
        )
      : undefined
  const job = jobs.find((item) => item.id === update.evidence!.job)
  if (!job || job.input.format !== "verify" || job.status !== "completed" || !job.verify)
    return refuse(`Evidence job ${update.evidence.job} is not a completed verify job of this design.`)
  if (claimed && job.input.revision !== document.revision)
    return refuse(
      `Evidence job ${job.id} verified ${job.input.revision}, not the current revision ${document.revision ?? "(unpublished)"}. Run one verify on the current revision and cite it.`,
    )
  const seen = observed(job, update)
  if (!seen)
    return refuse(
      `Evidence job ${job.id} verified round ${job.verify.round}, not ${name} (round ${note.round}). Run design_export {"revision":"${document.revision}","format":"verify","round":${note.round}} and cite that job.`,
    )
  if (!claimed) return undefined
  if (update.status === "partial")
    return reason
      ? undefined
      : { text: `${REFUSED} partial for ${name} needs a reason saying what still differs from the note.` }
  if (!seen.found)
    return refuse(
      `${name} cannot be resolved: ${job.id} did not find its element in ${job.input.revision} (${seen.reason}). Record it unresolved or accepted with a reason, or restore the element and verify again.`,
    )
  if (seen.blocking)
    return refuse(
      `${name} cannot be resolved: ${job.id} found blocking findings for it (${seen.findings.filter((finding) => finding.startsWith("error ·")).join("; ") || seen.reason}). Fix them, publish, verify again, or record partial with a reason.`,
    )
  // A measured delta is the visible evidence that the element was acted on: no change refuses resolved.
  // Three cases are not evidence either way and pass on the completed verify alone: a page-level note
  // (the whole variant or body cannot be compared as one element: its crop is clamped and its markup
  // carries scripts and animation, so renderers do not measure it), a delta that could not be measured
  // (the element was not located on the note's revision), and a behavior a capture cannot show,
  // verified by a scenario added or changed since that revision which acted on the element.
  if (update.status !== "resolved" || !seen.delta || seen.delta.changed) return undefined
  if (DesignVerify.isPage(note.item.target) || DesignVerify.unmeasured(seen.delta) || seen.exercised?.length)
    return undefined
  return refuse(
    `${name} cannot be resolved: ${job.id} saw no change to its element since the revision the note was taken on (pixels, text, markup, style, position and size are the same${seen.width ? ` at ${seen.width}px` : ""}). Change the element the note names, publish and verify again; for a behavior a capture cannot show (hover, focus, a script), add or update a scenario on the note's screen that acts on its element, publish and verify again; or record it unresolved or accepted with a reason saying why it stays as it is.`,
  )
}

/**
 * A status that says the note was acted on. Only these are a claim a semantic review can contradict:
 * `unresolved` and `accepted` say the note was not carried out, and why.
 */
export const isClaim = (update: Pick<Design.NoteUpdate, "status">) =>
  update.status === "resolved" || update.status === "partial"

/**
 * What a semantic review is shown for one claimed fix: what the reviewer asked for, and what the cited
 * verify saw of that note. Nothing else of the design goes with it (no other note or job, no capture
 * path, no locator), so a review does not grow with the design's history.
 */
export function claim(document: Rounds, update: Design.NoteUpdate, jobs: ReadonlyArray<Design.Job>) {
  const note = (document.notes ?? []).find((item) => same(item, update))
  const item = note?.item
  const seen = observed(
    jobs.find((job) => job.id === update.evidence?.job),
    update,
  )
  const addressed = note?.addressed?.summary
  const delta = seen?.delta
  return {
    request: { text: item?.text, label: item?.label, elementText: item?.elementText, screen: item?.params?.screen },
    observation: seen && {
      job: update.evidence?.job,
      found: seen.found,
      blocking: seen.blocking,
      reason: seen.reason,
      findings: seen.findings,
      scenarios: seen.scenarios,
      ...(seen.exercised?.length ? { exercised: seen.exercised } : {}),
    },
    // What the agent says it changed and what the verify saw change in the element, where the note was taken.
    // The review clips this evidence in the middle, so the delta flags lead and the free text is cut first
    // and comes last: a long summary or element text never pushes `changed` out of what System One reads.
    change:
      addressed || delta
        ? {
            ...(delta ? { delta: flagsFirst(delta) } : {}),
            // Said in words, so an all-false delta is not read as "nothing changed".
            ...(delta && DesignVerify.unmeasured(delta) ? { unmeasured: DesignVerify.describe(delta) } : {}),
            ...(item?.width || item?.platform ? { taken: { width: item.width, platform: item.platform } } : {}),
            ...(seen?.width || seen?.platform ? { verified: { width: seen.width, platform: seen.platform } } : {}),
            ...(addressed ? { addressed: DesignApproval.clip(addressed, CLAIM_CLIP.addressed) } : {}),
          }
        : undefined,
  }
}

/** Code points of the free text a claim's change evidence keeps: the addressed summary and each element text. */
const CLAIM_CLIP = { addressed: 200, text: 120 } as const

/** The delta with its flags in front and its element text clipped behind them. */
function flagsFirst(delta: Design.VerifyDelta) {
  const { textBefore, textAfter, ...flags } = delta
  return {
    ...flags,
    ...(textBefore ? { textBefore: DesignApproval.clip(textBefore, CLAIM_CLIP.text) } : {}),
    ...(textAfter ? { textAfter: DesignApproval.clip(textAfter, CLAIM_CLIP.text) } : {}),
  }
}

/** One note status that was refused, or recorded without a System One verdict, and why. */
export interface Marked {
  readonly feedback: string
  readonly index: number
  readonly reason: string
}

/**
 * What one update did to the note statuses it carried: how many were recorded, which of those went in
 * without a System One verdict, and which were refused. `context` holds the lists the refusals point
 * at (the recorded notes, the verify jobs), each once. Told to the agent in the tool result; nothing
 * here is stored.
 */
export interface Outcome {
  readonly recorded: number
  readonly unverified: ReadonlyArray<Marked>
  readonly refused: ReadonlyArray<Marked>
  readonly context: ReadonlyArray<string>
}

/**
 * What became of the addressed marks of one update: the counts, one line per ignored or refused mark,
 * then the lists the refusals point at.
 */
export const marks = (ticked: Ticked) => [
  `Addressed: marked ${ticked.applied}, ignored ${ticked.ignored.length}, refused ${ticked.refused.length}.`,
  ...[...ticked.ignored, ...ticked.refused].map((item) => `${item.feedback} #${item.index}: ${item.reason}`),
  ...ticked.context,
]

/** One line per refusal, then the lists they point at. */
export const refusals = (outcome: Pick<Outcome, "refused" | "context">) => [
  ...outcome.refused.map((item) => `${item.feedback} #${item.index}: ${item.reason}`),
  ...outcome.context,
]

/**
 * Why the review cannot end or be approved now: how many notes of each round still await an outcome,
 * what to do about them and the call that lists a round's notes, then the notes themselves (see
 * `recite`). Undefined when every note has an outcome.
 */
export function blocking(document: Rounds & Partial<Pick<Design.Info, "id">>) {
  const pending = open(document)
  if (!pending.length) return undefined
  const rounds = [...new Set(pending.map((note) => note.round))].toSorted((a, b) => a - b)
  const describe = (round: number, position: number) => {
    const count = pending.filter((note) => note.round === round).length
    return `${position === 0 ? "Round" : "round"} ${round} has ${count} note${count === 1 ? "" : "s"} without a recorded outcome`
  }
  return `${rounds.map(describe).join("; ")}. Fix them, mark each with design_document update addressed, publish one revision, run one verify per round (design_export format verify with round set) and record each note with design_document update notes; unresolved or accepted with a reason are allowed. Every note of a round with its text: design_read {${document.id ? `"id":"${document.id}",` : ""}"section":"notes","round":${rounds.length === 1 ? rounds[0] : "<round>"}}.\n${recite(document)}`
}

/**
 * The status of every round that still has a note without an outcome, newest round first: how many of
 * its notes the agent marked addressed and how many have an outcome, then the notes still without one
 * with their text. At most `LISTED.limit` notes are quoted across all rounds, so the text stays bounded
 * however many rounds are pending; the rest are counted. Empty when every note has an outcome.
 */
export function recite(document: Rounds) {
  const pending = open(document)
  const rounds = [...new Set(pending.map((note) => note.round))].toSorted((a, b) => b - a)
  return rounds
    .reduce(
      (listing, round) => {
        const all = notes(document, round)
        const left = pending.filter((note) => note.round === round)
        const shown = Math.min(listing.room, left.length)
        return {
          room: listing.room - shown,
          lines: [
            ...listing.lines,
            `Round ${round}: ${all.filter((note) => note.addressed).length} of ${all.length} addressed, ${all.filter((note) => note.status !== "open").length} recorded. Still without an outcome:`,
            DesignApproval.worklist(left, { limit: shown, clip: LISTED.clip }),
          ],
        }
      },
      { room: LISTED.limit as number, lines: [] as string[] },
    )
    .lines.join("\n")
}

/** Metadata key of the continuation a round gets when the agent stops while notes await an outcome. */
export const CONTINUATION_KEY = "designRound"

/**
 * The prompt that sends the agent back to a round it stopped short of finishing: what is still
 * missing (addressed marks for the open round, the publish that answers it, one verify on the current
 * revision per round with open notes, the outcomes), then those notes with their text (see `recite`).
 * Undefined when every note has an outcome.
 */
export function continuation(document: Rounds & Pick<Design.Info, "id" | "revision">, jobs: ReadonlyArray<Design.Job>) {
  const pending = open(document)
  const last = latest(document)
  if (!pending.length || !last) return undefined
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`
  const left = unaddressed(document).length
  const unverified = [...new Set(pending.map((note) => note.round))]
    .toSorted((a, b) => a - b)
    .filter(
      (round) =>
        !jobs.some(
          (job) =>
            job.input.format === "verify" &&
            job.status === "completed" &&
            job.input.revision === document.revision &&
            job.verify?.round === round,
        ),
    )
  const missing = [
    left ? `an addressed mark or an outcome for ${plural(left, "note")} of round ${last.number}` : "",
    last.published ? "" : `the design_preview publish that answers round ${last.number}`,
    unverified.length
      ? `a verify of the current revision for ${unverified.length === 1 ? "round" : "rounds"} ${unverified.join(", ")} (design_export format verify with round set; wait for its native monitor)`
      : "",
    `an outcome for ${plural(pending.length, "note")} (design_document update notes)`,
  ].filter(Boolean)
  return [
    `Design ${document.id}: the feedback round is not finished. You stopped while ${plural(pending.length, "note")} still ${pending.length === 1 ? "has" : "have"} no recorded outcome.`,
    `Still missing: ${missing.join("; ")}.`,
    recite(document),
    "Continue now: fix the notes, mark each addressed, publish one revision, run one verify per round and record each note's outcome; unresolved or accepted with a reason are allowed for a note you will not change. Then reply to the reviewer with the outcomes. This reminder is sent once per round.",
  ].join("\n")
}

/** The verify jobs of a design, newest first, as a refusal or report names them. */
export function describeJobs(jobs: ReadonlyArray<Design.Job>, limit = 5) {
  const recent = jobs
    .filter((job) => job.input.format === "verify")
    .toSorted((a, b) => (b.finished ?? b.created) - (a.finished ?? a.created))
    .slice(0, limit)
  if (!recent.length)
    return "Verify jobs: none. Start one with design_export format verify and wait for its native monitor to complete."
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

/**
 * Up to ten notes, for an error that has to name the ones the agent may update. "Known", so the line
 * is not read as the count of statuses an update recorded, which it can follow.
 */
export function describeNotes(list: ReadonlyArray<Design.Note>, limit = 10) {
  if (!list.length) return "Known notes: none."
  return `Known notes: ${list
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
