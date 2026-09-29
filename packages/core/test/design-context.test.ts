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

// The store's documents and availability, changed between reads the way a Session's steps observe them.
let documents: Design.Info[] = []
let unreadable = false

const store = Layer.mock(DesignStore.Service, {
  list: () =>
    unreadable
      ? Effect.fail(new Design.Error({ code: "unavailable", message: "Design store is unreadable" }))
      : Effect.succeed(documents),
  approval: () => Effect.succeed(approval),
})

const reset = (next: Design.Info[]) =>
  Effect.sync(() => {
    documents = next
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
})
