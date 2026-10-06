import { describe, expect, test } from "bun:test"
import { designRoundSummary } from "@opencode/util/design-round-summary"
import { previewLoading, type RoundFacts, type RoundStage } from "@opencode/core/design/ui/loading"

// The review page keeps its own serialized progress function; the shared projection the terminal and the app
// use must count and name a round the way it does whenever the document alone decides.
const loader = previewLoading()

type Note = RoundFacts["notes"][number] & { readonly round: number }

const facts = (published: boolean, notes: ReadonlyArray<Note>): RoundFacts => ({
  published,
  answered: published,
  notes,
  open: notes.filter((note) => note.status === "open").length,
  queued: false,
  inbox: false,
  // Unknown agent and no verify: the page decides from the notes, like the projection.
  agent: "unknown",
  idle: 0,
  busy: false,
  onLatest: true,
  connected: false,
})

const cases: Array<{ published: boolean; notes: Note[] }> = [
  { published: false, notes: [{ round: 1, status: "open" }] },
  { published: false, notes: [{ round: 1, status: "open", addressed: { summary: "done", at: 1 } }] },
  {
    published: true,
    notes: [
      { round: 1, status: "resolved" },
      { round: 1, status: "open" },
    ],
  },
  {
    published: true,
    notes: [
      { round: 1, status: "resolved" },
      { round: 1, status: "partial" },
      { round: 1, status: "unresolved" },
      { round: 1, status: "accepted", by: "reviewer" },
    ],
  },
]

describe("round summary parity with the review page", () => {
  test.each(cases)("counts and stage match previewLoading().progress (%#)", (item: (typeof cases)[number]) => {
    const summary = designRoundSummary({
      revision: "rev_2",
      rounds: [{ number: 1, revision: "rev_1", ...(item.published ? { published: "rev_2" } : {}) }],
      notes: item.notes,
    }).latest!
    const page = loader.progress(facts(item.published, item.notes))
    // The projection's stage is one of the page's (RoundStage). The page says "recording" while it cannot see a
    // verify; the document says every note is recorded.
    expect<RoundStage>(summary.stage).toBe(page.stage === "recording" && summary.open === 0 ? "recorded" : page.stage)
    expect(summary).toMatchObject({
      total: page.total,
      addressed: page.addressed,
      recorded: page.recorded,
      resolved: page.resolved,
      partial: page.partial,
      reviewer: page.closed,
    })
    expect(summary.unresolved + summary.accepted).toBe(page.unresolved + page.accepted + page.closed)
  })
})
