import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Design } from "@opencode/schema/design"
import { Session } from "@opencode/schema/session"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { DesignContext } from "@opencode/core/design/context"
import { DesignStore } from "@opencode/core/design/store"
import { Instructions } from "@opencode/core/instructions/index"
import { it } from "./lib/effect"
import { readInitial, readUpdate } from "./lib/instructions"

const sessionID = Session.ID.make("ses_design_context")

const info = (input: Partial<Design.Info> & Pick<Design.Info, "id" | "name">): Design.Info => ({
  sessionID,
  journey: "existing",
  engine: "html",
  kind: "screen",
  target: "web",
  root: `/project/.red/code/design/${input.id}/work`,
  application: "/project",
  entry: "index.html",
  brief: { objective: "", audience: "", content: "", constraints: "", references: [] },
  decisions: [],
  questions: [],
  scenarios: [],
  designSystem: "",
  sources: [],
  tweaks: {},
  revision: null,
  approvedRevision: null,
  ended: false,
  updated: 1,
  ...input,
})

const approved = info({
  id: Design.ID.make("design_checkout"),
  name: "Checkout",
  revision: "rev_stone",
  approvedRevision: "rev_stone",
  brief: {
    objective: "Accessible checkout",
    audience: "Returning buyers",
    content: "Cart lines and totals",
    constraints: "No external fonts; preserve keyboard navigation",
    references: [],
  },
  decisions: [{ id: "palette", text: "Use the Stone palette" }],
  scenarios: [
    {
      id: "empty",
      name: "Empty cart",
      selector: "#cart",
      state: "empty",
      actions: [{ selector: "#clear", action: "click" }],
    },
  ],
  targets: [{ path: "src/routes/checkout.tsx", role: "Checkout page; loads the cart from the API" }],
})

const approval: Design.Approval = {
  version: 1,
  approvedAt: 1,
  variant: { id: "stone", name: "Stone" },
  revision: {
    id: "rev_stone",
    designID: approved.id,
    parent: null,
    name: "Stone",
    created: 1,
    files: {},
    document: approved,
  },
  assets: [],
  feedback: [],
  audits: [],
}

const draft = info({
  id: Design.ID.make("design_leads"),
  name: "Leads",
  journey: "new",
  target: "app",
  platform: "ios",
  brief: { objective: "Faster triage", audience: "", content: "", constraints: "", references: [] },
  questions: ["Keep bulk actions?"],
})

// The store's documents, jobs and availability, changed between reads the way a Session's steps observe them.
let documents: Design.Info[] = []
let renders: Design.Job[] = []
let unreadable = false

const store = Layer.mock(DesignStore.Service, {
  storage: "/design/store",
  blobs: "/design/blobs",
  list: () =>
    unreadable
      ? Effect.fail(new Design.Error({ code: "unavailable", message: "Design store is unreadable" }))
      : Effect.succeed(documents),
  approval: () => Effect.succeed(approval),
  jobs: () => Effect.succeed(renders),
})

const reset = (next: Design.Info[], jobs: Design.Job[] = []) =>
  Effect.sync(() => {
    documents = next
    renders = jobs
    unreadable = false
  })

const provided = <A, E>(effect: Effect.Effect<A, E, DesignContext.Service>) =>
  effect.pipe(Effect.provide(AppNodeBuilder.build(DesignContext.node, [DesignStore.node.replace(store)])))

describe("DesignContext", () => {
  it.effect("adds nothing to a Session without Design documents", () =>
    provided(
      Effect.gen(function* () {
        yield* reset([])
        const context = yield* DesignContext.Service
        expect((yield* readInitial(context.load(sessionID))).text).toBe("")
      }),
    ),
  )

  it.effect("re-supplies the approved requirements in every baseline and ignores later drafts", () =>
    provided(
      Effect.gen(function* () {
        yield* reset([approved])
        const context = yield* DesignContext.Service
        const initial = yield* readInitial(context.load(sessionID))
        expect(initial.text).toContain("Design design_checkout: Checkout. Target: Web. Review open.")
        expect(initial.text).toContain("Implementation contract (redcode rule):")
        expect(initial.text).toContain("Never copy its markup, fixtures or simulated requests into product files")
        expect(initial.text.indexOf("Implementation contract")).toBeLessThan(initial.text.indexOf("Objective:"))
        expect(initial.text).toContain("Selected variant: Stone (stone).")
        expect(initial.text).toContain(
          "Target product files: src/routes/checkout.tsx (Checkout page; loads the cart from the API)",
        )
        expect(initial.text).toContain("Constraints: No external fonts; preserve keyboard navigation")
        expect(initial.text).toContain("- Use the Stone palette")
        expect(initial.text).toContain("click #clear")
        // Resume and compaction render the epoch baseline again from the stored value.
        expect(Instructions.renderInitial(context.load(sessionID), initial.values)).toBe(initial.text)

        yield* reset([
          {
            ...approved,
            revision: "rev_unapproved",
            brief: { ...approved.brief, objective: "UNAPPROVED REDESIGN" },
            questions: ["Draft question"],
          },
        ])
        const drafted = yield* readUpdate(context.load(sessionID), initial)
        expect(drafted.changed).toBe(false)
        expect(Instructions.renderInitial(context.load(sessionID), drafted.values)).not.toContain("UNAPPROVED REDESIGN")
      }),
    ),
  )

  it.effect("tracks draft designs and announces when they are gone", () =>
    provided(
      Effect.gen(function* () {
        yield* reset([draft])
        const context = yield* DesignContext.Service
        const initial = yield* readInitial(context.load(sessionID))
        expect(initial.text).toContain("Design design_leads: Leads. Target: iOS app. Review open.")
        expect(initial.text).toContain("Objective: Faster triage. Open questions: Keep bulk actions?.")
        expect(initial.text).toContain("This design is not approved")
        expect(initial.text).not.toContain("Implementation contract")

        yield* reset([{ ...draft, ended: true }])
        const closed = yield* readUpdate(context.load(sessionID), initial)
        expect(closed.text).toContain("This supersedes the previous Design context.")
        expect(closed.text).toContain("Review closed.")

        yield* reset([])
        expect((yield* readUpdate(context.load(sessionID), closed)).text).toBe(
          "This Session no longer has Design documents. Do not rely on the previous Design context.",
        )
      }),
    ),
  )

  it.effect("keeps the admitted requirements while the Design store is unreadable", () =>
    provided(
      Effect.gen(function* () {
        yield* reset([approved])
        const context = yield* DesignContext.Service
        const initial = yield* readInitial(context.load(sessionID))
        yield* Effect.sync(() => {
          unreadable = true
        })
        const update = yield* readUpdate(context.load(sessionID), initial)
        expect(update.changed).toBe(false)
        expect(Instructions.renderInitial(context.load(sessionID), update.values)).toContain(
          "Implementation contract (redcode rule):",
        )
      }),
    ),
  )

  it.effect("retains the draft brief and direction after compaction without updates for publication alone", () =>
    provided(
      Effect.gen(function* () {
        const document = {
          ...draft,
          brief: {
            objective: "Faster triage",
            audience: "Operators",
            content: "Queue and owner",
            constraints: "Keep dense layout",
            references: ["docs/triage.md"],
          },
          decisions: [{ id: "direction", text: "Use the existing split view" }],
          designSystem: { tokens: "src/theme.css", framework: "solid" },
        }
        yield* reset([document])
        const context = yield* DesignContext.Service
        const initial = yield* readInitial(context.load(sessionID))
        for (const detail of [
          "Operators",
          "Queue and owner",
          "Keep dense layout",
          "docs/triage.md",
          "Use the existing split view",
          "src/theme.css",
        ])
          expect(initial.text).toContain(detail)
        expect(Instructions.renderInitial(context.load(sessionID), initial.values)).toBe(initial.text)
        yield* reset([{ ...document, revision: "rev_next", updated: 2 }])
        expect((yield* readUpdate(context.load(sessionID), initial)).changed).toBe(false)
        yield* reset([{ ...document, decisions: [{ id: "direction", text: "Use the confirmed compact table" }] }])
        const changed = yield* readUpdate(context.load(sessionID), initial)
        expect(changed.changed).toBe(true)
        expect(changed.text).toContain("Use the confirmed compact table")
        expect(changed.text).not.toContain("Use the existing split view")
      }),
    ),
  )

  it.effect("names the round whose notes wait for an outcome and announces progress with the round state alone", () =>
    provided(
      Effect.gen(function* () {
        const note = (index: number, status: Design.NoteStatus, round = 9): Design.Note => ({
          feedback: `msg_round_${round}`,
          index,
          round,
          item: { target: `#n${index}`, text: `Note ${index}` },
          status,
          updated: 1,
        })
        const round = (number: number, published?: string): Design.Round => ({
          number,
          opened: number,
          revision: "rev_one",
          feedback: [`msg_round_${number}`],
          ...(published ? { published } : {}),
        })
        const line = `Round 9 has notes without an outcome; list them with design_read {"id":"${draft.id}","section":"notes"}`
        const waiting = { ...draft, rounds: [round(9)], notes: [note(1, "open"), note(2, "open"), note(3, "open")] }
        yield* reset([waiting])
        const context = yield* DesignContext.Service
        const initial = yield* readInitial(context.load(sessionID))
        expect(initial.text).toContain(line)
        expect(initial.text).not.toMatch(/\b3 notes\b/)

        // Recording outcomes or marking notes one by one announces only the round state, never the whole context.
        const progressed = {
          ...waiting,
          notes: [note(1, "resolved"), { ...note(2, "open"), addressed: { summary: "Done", at: 2 } }, note(3, "open")],
        }
        yield* reset([progressed])
        const partway = yield* readUpdate(context.load(sessionID), initial)
        expect(partway.changed).toBe(true)
        expect(partway.text).toStartWith("Design review progress.")
        expect(partway.text).toContain("msg_round_9 #2 [addressed] Note 2")
        expect(partway.text).toContain("msg_round_9 #3 [unaddressed] Note 3")
        expect(partway.text).not.toContain("msg_round_9 #1")
        expect(partway.text).not.toContain("Objective:")
        expect(partway.text).toContain("next step: fix the 1 unaddressed note of round 9")
        // The same state read again admits nothing.
        expect((yield* readUpdate(context.load(sessionID), partway)).changed).toBe(false)
        yield* reset([{ ...waiting, notes: [note(1, "resolved"), note(2, "accepted"), note(3, "unresolved")] }])
        const settled = yield* readUpdate(context.load(sessionID), partway)
        expect(settled.changed).toBe(true)
        expect(settled.text).not.toContain("has notes without an outcome")

        // An older round left open is named with its round; an ended review names none.
        const older = {
          ...waiting,
          rounds: [round(9, "rev_two"), round(10)],
          notes: [note(1, "open"), note(1, "accepted", 10)],
        }
        yield* reset([older])
        expect((yield* readInitial(context.load(sessionID))).text).toContain(
          `Round 9 has notes without an outcome; list them with design_read {"id":"${draft.id}","section":"notes","round":9}`,
        )
        yield* reset([{ ...older, ended: true }])
        expect((yield* readInitial(context.load(sessionID))).text).not.toContain("has notes without an outcome")
        // A requested end keeps the pending round visible and tells the agent the review ends after it.
        yield* reset([{ ...older, endRequested: true }])
        const requested = (yield* readInitial(context.load(sessionID))).text
        expect(requested).toContain("Round 9 has notes without an outcome")
        expect(requested).toContain(
          "Review open until every note has an outcome: the user asked to end it after this round",
        )
      }),
    ),
  )

  it.effect("recites the open notes, the publish, the verify and the next step after compaction, bounded", () =>
    provided(
      Effect.gen(function* () {
        const notes = Array.from(
          { length: 13 },
          (_, index): Design.Note => ({
            feedback: "msg_review",
            index: index + 1,
            round: 2,
            item: { target: `#n${index + 1}`, text: `Ajustar o espaçamento ${index + 1} ${"大".repeat(300)}` },
            status: index === 0 ? "resolved" : "open",
            addressed: { summary: "Done", at: 2 },
            updated: 1,
          }),
        )
        const document = {
          ...draft,
          revision: "rev_three",
          rounds: [{ number: 2, opened: 1, revision: "rev_two", feedback: ["msg_review"], published: "rev_three" }],
          notes,
        }
        const job = (status: Design.Job["status"], extra: Partial<Design.Job> = {}): Design.Job => ({
          id: `render_${status}`,
          designID: draft.id,
          input: { revision: "rev_three", format: "verify", round: 2 },
          status,
          progress: 0,
          result: null,
          error: null,
          created: status === "completed" ? 3 : 2,
          ...extra,
        })
        yield* reset([document])
        const context = yield* DesignContext.Service
        const initial = yield* readInitial(context.load(sessionID))
        // Resume and compaction render the epoch baseline from the stored value, so the state survives.
        expect(Instructions.renderInitial(context.load(sessionID), initial.values)).toBe(initial.text)
        expect(initial.text).toContain("msg_review #2 [addressed] Ajustar o espaçamento 2")
        expect(initial.text).not.toContain("msg_review #1 ")
        expect(initial.text).toContain(`and 2 more: design_read {"id":"${draft.id}","section":"notes"}`)
        expect(initial.text).toContain(
          `Published: rev_three; verify: none on the current revision; next step: design_export {"id":"${draft.id}","input":{"revision":"rev_three","format":"verify","round":2}}`,
        )
        // Each quoted note keeps a bounded part of its text.
        expect(initial.text.match(/大+/g)!.every((run) => run.length <= 160)).toBe(true)

        yield* reset([document], [job("running")])
        const running = yield* readUpdate(context.load(sessionID), initial)
        expect(running.text).toContain("verify: running (render_running); next step: wait for the native monitor")

        yield* reset([document], [job("failed", { error: "Browser unavailable: Chromium setup failed.\n    at x" })])
        const failed = yield* readUpdate(context.load(sessionID), running)
        expect(failed.text).toContain("verify: failed (render_failed): Browser unavailable: Chromium setup failed.;")
        expect(failed.text).toContain(
          'record each open note partial with the reason "verification unavailable: Browser unavailable: Chromium setup failed." citing render_failed',
        )
        expect(failed.text).not.toContain("    at x")

        const completed = job("completed", {
          verify: {
            revision: "rev_three",
            round: 2,
            width: 1440,
            notes: [
              {
                feedback: "msg_review",
                index: 2,
                label: "n2",
                found: true,
                blocking: false,
                findings: [],
                scenarios: [],
                reason: "found",
              },
            ],
            findings: [],
          },
        })
        yield* reset([document], [completed])
        const done = yield* readUpdate(context.load(sessionID), failed)
        expect(done.text).toContain("msg_review #2 [verified, no outcome]")
        expect(done.text).toContain("msg_review #3 [addressed]")
        expect(done.text).toContain(
          "verify: done (render_completed) on rev_three; next step: record each note's outcome in one design_document update notes citing render_completed",
        )
      }),
    ),
  )

  it.effect("renders an older admitted draft without the new optional brief fields", () =>
    provided(
      Effect.gen(function* () {
        const context = yield* DesignContext.Service
        const rendered = Instructions.renderInitial(context.load(sessionID), {
          "design/session": [
            {
              id: draft.id,
              name: draft.name,
              target: "iOS app",
              root: draft.root,
              ended: false,
              objective: "Faster triage",
              questions: [],
              system: "",
              approval: null,
            },
          ],
        })
        expect(rendered).toContain("Objective: Faster triage")
        expect(rendered).toContain("This design is not approved")
      }),
    ),
  )
})
