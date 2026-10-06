import { describe, expect, test } from "bun:test"
import { previewLoading, type RevisionFacts, type RoundFacts } from "@opencode/core/design/ui/loading"

const loader = previewLoading()

const notes = (statuses: string[], addressed = 0) =>
  statuses.map((status, index) => ({
    status: status as RoundFacts["notes"][number]["status"],
    ...(index < addressed ? { addressed: { summary: "Changed", at: 1 } } : {}),
  }))

const round = (facts: Partial<RoundFacts> = {}): RoundFacts => ({
  published: false,
  answered: false,
  notes: notes(["open", "open", "open"]),
  open: 3,
  queued: false,
  inbox: false,
  agent: "working",
  idle: 0,
  busy: false,
  onLatest: true,
  connected: true,
  ...facts,
})

const answered = (facts: Partial<RoundFacts> = {}) =>
  round({
    published: true,
    answered: true,
    notes: notes(["resolved", "resolved", "partial"]),
    open: 0,
    agent: "idle",
    idle: 5000,
    verify: { status: "completed", current: true },
    ...facts,
  })

describe("round progress", () => {
  test("a round waiting in the inbox is received", () => {
    expect(loader.progress(round({ queued: true }))).toMatchObject({ stage: "received", step: 0, halted: false })
  })

  test("a working agent is fixing, counting addressed marks and outcomes", () => {
    const progress = loader.progress(round({ notes: notes(["resolved", "open", "open"], 2) }))
    expect(progress).toMatchObject({ stage: "fixing", step: 1, addressed: 2, recorded: 1, total: 3 })
  })

  test("an agent idle for a moment is not stopped yet", () => {
    expect(loader.progress(round({ agent: "idle", idle: 1500 }))).toMatchObject({ stage: "received" })
  })

  test("an agent idle past the settle time stopped short of publishing", () => {
    expect(loader.progress(round({ agent: "idle", idle: 2500, notes: notes(["open", "open"], 1) }))).toMatchObject({
      stage: "stopped",
      step: 1,
      halted: true,
      addressed: 1,
    })
  })

  test("without a feed the stage never claims the agent stopped", () => {
    expect(loader.progress(round({ agent: "unknown", idle: 0 }))).toMatchObject({ stage: "received" })
    expect(loader.progress(round({ agent: "unknown", notes: notes(["open"], 1) }))).toMatchObject({ stage: "fixing" })
  })

  test("an answered round waits for its verify", () => {
    expect(
      loader.progress(round({ published: true, answered: true, notes: notes(["open", "open"], 2) })),
    ).toMatchObject({ stage: "published", step: 2 })
  })

  test("a verify of the latest revision in flight is verifying; an outdated one is not", () => {
    const base = { published: true, answered: true, notes: notes(["open"], 1) }
    expect(loader.progress(round({ ...base, verify: { status: "running", current: true } }))).toMatchObject({
      stage: "verifying",
      step: 3,
    })
    expect(loader.progress(round({ ...base, verify: { status: "running", current: false } }))).toMatchObject({
      stage: "published",
    })
  })

  test("an idle agent that published without a verify says so", () => {
    expect(
      loader.progress(round({ published: true, answered: true, agent: "idle", idle: 3000, notes: notes(["open"]) })),
    ).toMatchObject({ stage: "unverified", step: 2, halted: true })
  })

  test("a failed verify halts once the agent is idle", () => {
    expect(
      loader.progress(
        round({
          published: true,
          answered: true,
          agent: "idle",
          idle: 3000,
          verify: { status: "failed", current: true },
        }),
      ),
    ).toMatchObject({ stage: "verifyFailed", halted: true })
  })

  test("verified notes without an outcome are being recorded, then missing once the agent is idle", () => {
    const base = {
      published: true,
      answered: true,
      notes: notes(["resolved", "open"]),
      verify: { status: "completed" as const, current: true },
    }
    expect(loader.progress(round(base))).toMatchObject({ stage: "recording", step: 3, recorded: 1 })
    expect(loader.progress(round({ ...base, agent: "idle", idle: 2500 }))).toMatchObject({
      stage: "missing",
      step: 3,
      halted: true,
    })
  })

  test("ready for review only when every check holds, and the counts say what was marked", () => {
    const ready = loader.progress(
      answered({ notes: [...notes(["resolved", "resolved", "partial"]), { status: "accepted", by: "reviewer" }] }),
    )
    expect(ready).toMatchObject({ stage: "ready", step: 4, resolved: 2, partial: 1, accepted: 0, closed: 1 })
    const broken: Partial<RoundFacts>[] = [
      { open: 1 },
      { answered: false },
      { busy: true },
      { inbox: true },
      { onLatest: false },
      { connected: false },
      { idle: 1000 },
      { verify: { status: "completed", current: false } },
    ]
    for (const facts of broken) expect(loader.progress(answered(facts)).stage).not.toBe("ready")
    expect(loader.progress(answered({ onLatest: false })).stage).toBe("recorded")
    expect(loader.progress(answered({ agent: "working" })).stage).toBe("recording")
  })
})

const revision = (facts: Partial<RevisionFacts> = {}): RevisionFacts => ({
  shown: { id: "rev_answer", created: 300 },
  newer: 0,
  following: true,
  blocker: "",
  loading: false,
  failed: false,
  offline: false,
  round: { number: 9, opened: 100, revision: "rev_base", published: "rev_answer", answered: 300 },
  byAgent: true,
  ...facts,
})

describe("revision freshness", () => {
  test("the latest revision answering the round", () => {
    expect(loader.revision(revision())).toEqual({ chip: "latest", line: "answers" })
  })

  test("a revision only answers a round when the agent published it", () => {
    expect(loader.revision(revision({ byAgent: false })).line).toBe("yours")
    expect(loader.revision(revision({ byAgent: undefined })).line).toBe("answers")
  })

  test("a preview older than an open round, and a page publish while it is open", () => {
    const open = { number: 9, opened: 100, revision: "rev_base" }
    expect(loader.revision(revision({ shown: { id: "rev_base", created: 50 }, round: open })).line).toBe("before")
    expect(
      loader.revision(revision({ shown: { id: "rev_preset", created: 200 }, round: open, byAgent: false })).line,
    ).toBe("yours")
    expect(loader.revision(revision({ shown: { id: "rev_restore", created: 200 }, round: open })).line).toBe(
      "unanswered",
    )
  })

  test("a revision the agent published after answering", () => {
    expect(loader.revision(revision({ shown: { id: "rev_fix", created: 400 } })).line).toBe("after")
  })

  test("a newer revision is updating while nothing holds it back", () => {
    expect(loader.revision(revision({ newer: 1 }))).toEqual({ chip: "updating", line: "answers" })
    expect(loader.revision(revision({ loading: true })).chip).toBe("updating")
  })

  test("a blocked switch says why", () => {
    expect(loader.revision(revision({ newer: 1, blocker: "card" }))).toEqual({ chip: "behind", line: "card" })
    expect(loader.revision(revision({ newer: 1, blocker: "pending" }))).toEqual({ chip: "behind", line: "pending" })
    expect(loader.revision(revision({ newer: 1, blocker: "dialog" })).chip).toBe("behind")
  })

  test("an older revision the reader picked", () => {
    expect(loader.revision(revision({ newer: 2, following: false }))).toEqual({ chip: "behind", line: "older" })
  })

  test("a failed latest and a lost connection take the chip", () => {
    expect(loader.revision(revision({ failed: true, newer: 1 }))).toEqual({ chip: "failed", line: "failed" })
    expect(loader.revision(revision({ offline: true })).chip).toBe("offline")
  })

  test("no round, no line", () => {
    expect(loader.revision(revision({ round: undefined }))).toEqual({ chip: "latest", line: "" })
  })
})

describe("agent activity", () => {
  const play = (events: Parameters<typeof loader.reduce>[1][]) =>
    events.reduce((state, event) => loader.reduce(state, event), loader.initial(0))
  const pick = (state: ReturnType<typeof loader.initial>) => ({
    agent: state.agent,
    tool: state.tool,
    detail: state.detail,
    until: state.until,
  })

  test("a turn that failed or was interrupted is not plain idle", () => {
    expect(
      pick(
        play([
          { type: "agent", state: "working" },
          { type: "agent", state: "idle" },
        ]),
      ),
    ).toEqual({
      agent: "idle",
      tool: "",
      detail: "",
      until: 0,
    })
    expect(pick(play([{ type: "agent", state: "idle", outcome: "failed", message: "Overloaded" }]))).toEqual({
      agent: "failed",
      tool: "",
      detail: "Overloaded",
      until: 0,
    })
    expect(pick(play([{ type: "agent", state: "idle", outcome: "interrupted", message: "user" }])).agent).toBe(
      "interrupted",
    )
    // The next turn clears the reason.
    expect(
      pick(
        play([
          { type: "agent", state: "idle", outcome: "failed", message: "Overloaded" },
          { type: "agent", state: "working" },
        ]),
      ),
    ).toEqual({ agent: "thinking", tool: "", detail: "", until: 0 })
  })

  test("a scheduled retry waits until its time and ends with the next activity", () => {
    const retrying = play([
      { type: "agent", state: "working" },
      { type: "wait", wait: "retry", active: true, until: 5000, message: "Overloaded" },
    ])
    expect(pick(retrying)).toEqual({ agent: "retrying", tool: "", detail: "Overloaded", until: 5000 })
    expect(pick(loader.reduce(retrying, { type: "wait", wait: "retry", active: false })).agent).toBe("thinking")
    expect(pick(loader.reduce(retrying, { type: "tool", tool: "read", status: "running" })).agent).toBe("tool")
    expect(pick(loader.reduce(retrying, { type: "agent", state: "idle" })).agent).toBe("idle")
  })

  test("a permission waits for approval inside the tool that asked, and its end returns to that tool", () => {
    const asking = play([
      { type: "agent", state: "working" },
      { type: "tool", tool: "bash", status: "running" },
      { type: "wait", wait: "permission", active: true, message: "bash" },
    ])
    expect(pick(asking)).toEqual({ agent: "permission", tool: "bash", detail: "bash", until: 0 })
    expect(pick(loader.reduce(asking, { type: "wait", wait: "permission", active: false })).agent).toBe("tool")
    // A rejected permission fails the tool, which ends the wait too.
    expect(pick(loader.reduce(asking, { type: "tool", tool: "bash", status: "failed" })).agent).toBe("thinking")
  })

  test("compaction is a wait, and ending a wait the agent is not in changes nothing", () => {
    const compacting = play([
      { type: "agent", state: "working" },
      { type: "wait", wait: "compaction", active: true },
    ])
    expect(compacting.agent).toBe("compacting")
    expect(loader.reduce(compacting, { type: "wait", wait: "retry", active: false })).toBe(compacting)
    expect(loader.reduce(compacting, { type: "wait", wait: "compaction", active: false }).agent).toBe("thinking")
  })
})
