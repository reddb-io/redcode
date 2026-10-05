import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Design } from "@opencode/schema/design"
import { Session } from "@opencode/schema/session"
import { Global } from "@opencode/util/global"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DesignDocumentTool } from "../src/design/document-tool"
import { DesignRounds } from "../src/design/rounds"
import { DesignStore } from "../src/design/store"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Form } from "../src/form"
import { Intelligence } from "../src/intelligence"
import { Location } from "../src/location"
import { Permission } from "../src/permission"
import { SessionStore } from "../src/session/store"
import { Tool } from "../src/tool"
import { DesignDocumentToolPlugin } from "../src/tool/plugin/design-document"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const decoder = Schema.decodeUnknownSync(DesignDocumentTool.Input)
// Compared structurally against plain literals, whose ids are unbranded strings.
const decode = (value: unknown): unknown => decoder(value)

describe("design_document input", () => {
  test("keeps every operation and its payload through decoding", () => {
    const inputs: unknown[] = [
      { action: "list" },
      {
        action: "create",
        input: { name: "Dark mode", journey: "existing", engine: "react", kind: "screen", application: "apps/admin" },
      },
      {
        action: "create",
        input: { name: "Leads", journey: "new", engine: "html", kind: "flow", target: "app", platform: "ios" },
      },
      {
        action: "create",
        input: { name: "Quarterly", journey: "new", engine: "html", kind: "deck", target: "presentation" },
      },
      { action: "update", id: "design_fixture", input: { questions: ["Which theme?"], entry: "src/main.tsx" } },
      {
        action: "update",
        id: "design_fixture",
        input: { targets: [{ path: "apps/admin/src/leads/page.tsx", role: "Leads table with server pagination" }] },
      },
      {
        action: "update",
        id: "design_fixture",
        input: {
          targets: Array.from({ length: 20 }, (_, index) => ({ path: `src/${index}.tsx`, role: "r".repeat(200) })),
        },
      },
      {
        action: "update",
        id: "design_fixture",
        input: { notes: [{ feedback: "msg_review", index: 1, status: "resolved", evidence: { job: "job_verify" } }] },
      },
      {
        action: "update",
        id: "design_fixture",
        input: { addressed: [{ feedback: "msg_review", index: 2, summary: "Rotate per secret" }] },
      },
      { action: "reopen", id: "design_fixture" },
      { action: "refresh", id: "design_fixture" },
      { action: "detect" },
      { action: "detect", input: { application: "apps/web" } },
    ]
    inputs.forEach((input) => expect(decode(input)).toEqual(input))
  })

  test("preserves structured design-system metadata on create and update", () => {
    const designSystem = {
      application: "apps/profile",
      framework: "react",
      components: [{ name: "SubscriptionCard", states: ["trial", "active", "past_due"] }],
      tokens: { colors: { accent: "#123456" }, spacing: [4, 8, 16] },
      darkMode: true,
    }
    const create = {
      action: "create",
      input: { name: "Profile", journey: "existing", engine: "react", kind: "screen", designSystem },
    }
    const update = { action: "update", id: "design_profile", input: { designSystem } }
    expect(decode(create)).toEqual(create)
    expect(decode(update)).toEqual(update)
    expect(decode({ ...update, input: { designSystem: "Use project components" } })).toEqual({
      ...update,
      input: { designSystem: "Use project components" },
    })
    expect(() => decode({ ...update, input: { designSystem: 42 } })).toThrow()
  })

  test("never lets the agent record statuses as the reviewer", () => {
    expect(
      decode({
        action: "update",
        id: "design_fixture",
        input: { by: "reviewer", notes: [{ feedback: "msg_review", index: 1, status: "accepted", reason: "Kept" }] },
      }),
    ).toEqual({
      action: "update",
      id: "design_fixture",
      input: { notes: [{ feedback: "msg_review", index: 1, status: "accepted", reason: "Kept" }] },
    })
  })

  test("rejects missing actions and incomplete conditional arguments", () => {
    const inputs = [
      {},
      { action: "unknown" },
      { action: "create" },
      { action: "create", input: {} },
      { action: "create", input: { name: "Dark mode", journey: "existing", engine: "react" } },
      { action: "create", input: { name: "", journey: "existing", engine: "react", kind: "screen" } },
      { action: "create", input: { name: "Leads", journey: "new", engine: "html", kind: "screen", target: "tv" } },
      { action: "create", input: { name: "Leads", journey: "new", engine: "html", kind: "screen", platform: "web" } },
      { action: "update", input: {} },
      { action: "update", id: "design_fixture" },
      { action: "update", id: "design_fixture", input: { questions: [42] } },
      { action: "update", id: "design_fixture", input: { targets: [{ path: "", role: "Page" }] } },
      { action: "update", id: "design_fixture", input: { targets: [{ path: "src/page.tsx", role: "r".repeat(201) }] } },
      {
        action: "update",
        id: "design_fixture",
        input: { targets: Array.from({ length: 21 }, (_, index) => ({ path: `src/${index}.tsx`, role: "Page" })) },
      },
      // `open` is never recorded by hand, and notes are numbered from 1.
      { action: "update", id: "design_fixture", input: { notes: [{ feedback: "msg", index: 1, status: "open" }] } },
      { action: "update", id: "design_fixture", input: { notes: [{ feedback: "msg", index: 0, status: "resolved" }] } },
      // An addressed mark says what changed, within 300 characters, and at most 100 go in one call.
      { action: "update", id: "design_fixture", input: { addressed: [{ feedback: "msg", index: 1, summary: "" }] } },
      { action: "update", id: "design_fixture", input: { addressed: [{ feedback: "msg", index: 1 }] } },
      {
        action: "update",
        id: "design_fixture",
        input: { addressed: [{ feedback: "msg", index: 1, summary: "s".repeat(301) }] },
      },
      {
        action: "update",
        id: "design_fixture",
        input: {
          addressed: Array.from({ length: 101 }, (_, index) => ({
            feedback: "msg",
            index: index + 1,
            summary: "Done",
          })),
        },
      },
      { action: "reopen" },
      { action: "refresh" },
      { action: "refresh", id: "invalid" },
    ]
    inputs.forEach((input) => expect(() => decode(input)).toThrow())
  })
})

const sessionID = Session.ID.make("ses_design_document")
const designID = Design.ID.make("design_document")
const note = (
  feedback: string,
  index: number,
  round: number,
  status: Design.NoteStatus,
  text: string,
  addressed?: string,
): Design.Note => ({
  feedback,
  index,
  round,
  item: { target: `#note-${index}`, text, label: `button "Rotate ${index}"` },
  status,
  ...(addressed ? { addressed: { summary: addressed, at: 1 } } : {}),
  updated: 1,
})
const reviewed = {
  id: designID,
  sessionID,
  name: "Clients",
  journey: "new",
  engine: "html",
  kind: "screen",
  target: "web",
  root: "/project/.red/code/design/design_document/work",
  application: "/project",
  entry: "index.html",
  brief: { objective: "", audience: "", content: "", constraints: "", references: [] },
  decisions: [],
  questions: [],
  scenarios: [],
  designSystem: "",
  sources: [],
  tweaks: {},
  revision: "rev_two",
  approvedRevision: null,
  ended: false,
  updated: 1,
  rounds: [
    { number: 8, opened: 1, revision: "rev_one", feedback: ["msg_eight"], published: "rev_two" },
    { number: 9, opened: 2, revision: "rev_two", feedback: ["msg_nine"] },
  ],
  notes: [
    // An older round's open note is listed too: an update can record a round a newer one has followed.
    note("msg_eight", 1, 8, "open", "Left over from round 8"),
    note("msg_nine", 1, 9, "resolved", "Rotate per secret", "Rotates one secret"),
    note("msg_nine", 2, 9, "open", `${"x".repeat(200)} and the rest of a long note`),
    note("msg_nine", 3, 9, "open", "Align the three actions\nin every row", "Aligned with a grid"),
    note("msg_nine", 4, 9, "accepted", "Keep the old colour"),
  ],
} satisfies Design.Info
const listed =
  "Recent verify jobs (newest first): render_9 (revision rev_two, round 9, completed, 4 of 4 notes found without blocking findings)."
const outcome: DesignRounds.Outcome = {
  recorded: 11,
  unverified: [
    { feedback: "msg_nine", index: 1, reason: "System One review inconclusive (evaluation_1)" },
    { feedback: "msg_nine", index: 4, reason: "System One review inconclusive (evaluation_1)" },
  ],
  refused: [
    { feedback: "msg_nine", index: 2, reason: "Note status refused: resolved for msg_nine #2 needs evidence." },
  ],
  context: [listed],
}
const report = [
  "Notes: recorded 11 (2 unverified), refused 1.",
  "msg_nine #2: Note status refused: resolved for msg_nine #2 needs evidence.",
  listed,
  "Unverified (2): System One review inconclusive (evaluation_1). These are recorded and need nothing more.",
  // The newest round first; an addressed mark counts, but only an outcome takes a note off the list.
  "Round 9: 2 of 4 addressed, 2 recorded. Still without an outcome:",
  'msg_nine #2 [open] button "Rotate 2"',
  `Note: ${"x".repeat(200)}…`,
  'msg_nine #3 [open, addressed] button "Rotate 3"',
  "Note: Align the three actions",
  "    in every row",
  "Round 8: 0 of 1 addressed, 0 recorded. Still without an outcome:",
  'msg_eight #1 [open] button "Rotate 1"',
  "Note: Left over from round 8",
].join("\n")

describe("design_document notes result", () => {
  test("says what was recorded, why each refusal, and which notes of each round are left", () => {
    expect(DesignDocumentTool.recorded(reviewed, { notes: outcome })).toBe(report)
  })

  test("is one line when every status was recorded and no round has an open note", () => {
    const closed = { ...reviewed, notes: reviewed.notes.map((item) => ({ ...item, status: "resolved" as const })) }
    expect(
      DesignDocumentTool.recorded(closed, { notes: { recorded: 3, unverified: [], refused: [], context: [] } }),
    ).toBe("Notes: recorded 3, refused 0.")
    expect(DesignDocumentTool.recorded({}, { notes: { recorded: 0, unverified: [], refused: [], context: [] } })).toBe(
      "Notes: recorded 0, refused 0.",
    )
  })

  test("groups unverified statuses by cause and lists at most thirty open notes", () => {
    const many = {
      rounds: [{ number: 1, opened: 1, revision: "rev_one", feedback: ["msg_one"] }],
      notes: Array.from({ length: 34 }, (_, index) => note("msg_one", index + 1, 1, "open", `Note ${index + 1}`)),
    }
    const lines = DesignDocumentTool.recorded(many, {
      notes: {
        recorded: 3,
        unverified: [
          { feedback: "msg_one", index: 1, reason: "System One review inconclusive (evaluation_1)" },
          { feedback: "msg_one", index: 2, reason: "System One review unavailable: System One did not answer" },
          { feedback: "msg_one", index: 3, reason: "System One review inconclusive (evaluation_1)" },
        ],
        refused: [],
        context: [],
      },
    }).split("\n")

    expect(lines.slice(0, 4)).toEqual([
      "Notes: recorded 3 (3 unverified), refused 0.",
      "Unverified (2): System One review inconclusive (evaluation_1). These are recorded and need nothing more.",
      "Unverified (1): System One review unavailable: System One did not answer. These are recorded and need nothing more.",
      "Round 1: 0 of 34 addressed, 0 recorded. Still without an outcome:",
    ])
    // Two lines per listed note, then the count of the rest.
    expect(lines).toHaveLength(4 + 30 * 2 + 1)
    expect(lines.at(-3)).toBe('msg_one #30 [open] button "Rotate 30"')
    expect(lines.at(-1)).toBe("and 4 more")
  })

  test("reports addressed marks, and quotes at most thirty notes however many rounds wait", () => {
    const rounds = {
      rounds: [
        { number: 1, opened: 1, revision: "rev_one", feedback: ["msg_one"], published: "rev_two" },
        { number: 2, opened: 2, revision: "rev_two", feedback: ["msg_two"] },
      ],
      notes: [
        ...Array.from({ length: 25 }, (_, index) => note("msg_one", index + 1, 1, "open", `Old ${index + 1}`)),
        ...Array.from({ length: 25 }, (_, index) =>
          note("msg_two", index + 1, 2, "open", `New ${index + 1}`, index < 3 ? "Changed" : undefined),
        ),
      ],
    }
    const lines = DesignDocumentTool.recorded(rounds, {
      addressed: {
        applied: 3,
        ignored: [{ feedback: "msg_one", index: 9, reason: "already recorded resolved; the outcome stands." }],
        refused: [{ feedback: "msg_two", index: 99, reason: "Unknown note msg_two #99." }],
        context: ["Known notes: msg_two #25 (round 2, open)."],
      },
    }).split("\n")

    expect(lines.slice(0, 5)).toEqual([
      "Addressed: marked 3, ignored 1, refused 1.",
      "msg_one #9: already recorded resolved; the outcome stands.",
      "msg_two #99: Unknown note msg_two #99.",
      "Known notes: msg_two #25 (round 2, open).",
      "Round 2: 3 of 25 addressed, 0 recorded. Still without an outcome:",
    ])
    expect(lines[5]).toBe('msg_two #1 [open, addressed] button "Rotate 1"')
    // The newest round spends the budget first; the older round gets what is left and a count.
    const older = lines.indexOf("Round 1: 0 of 25 addressed, 0 recorded. Still without an outcome:")
    expect(older).toBe(5 + 25 * 2)
    expect(lines.slice(older + 1)).toEqual([
      ...Array.from({ length: 5 }, (_, index) => [
        `msg_one #${index + 1} [open] button "Rotate ${index + 1}"`,
        `Note: Old ${index + 1}`,
      ]).flat(),
      "and 20 more",
    ])
  })
})

// What the tool asked of the store, reset before the test.
const amended: Array<Design.Update> = []
const documentToolNode = makeLocationNode({
  name: "test/design-document-tool",
  layer: Layer.effectDiscard(registerToolPlugin(DesignDocumentToolPlugin.Plugin)),
  deps: [
    Tool.node,
    Permission.node,
    DesignStore.node,
    Form.node,
    Intelligence.node,
    SessionStore.node,
    Location.node,
    Global.node,
  ],
})
const tool = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, documentToolNode]), [
    Location.node.replace(tempLocationLayer),
    Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
    Form.node.replace(Layer.mock(Form.Service, {})),
    Intelligence.node.replace(Layer.mock(Intelligence.Service, {})),
    SessionStore.node.replace(Layer.mock(SessionStore.Service, {})),
    DesignStore.node.replace(
      Layer.mock(DesignStore.Service, {
        storage: "/design/store",
        blobs: "/design/blobs",
        amend: (_session, _id, input) =>
          Effect.sync(() => {
            amended.push(input)
            return {
              document: reviewed,
              ...(input.notes?.length ? { notes: outcome } : {}),
              ...(input.addressed?.length
                ? { addressed: { applied: input.addressed.length, ignored: [], refused: [], context: [] } }
                : {}),
            }
          }),
      }),
    ),
  ]),
)
const update = (input: Design.Update) => ({
  sessionID,
  ...toolIdentity,
  call: {
    type: "tool-call" as const,
    id: "call_design_document",
    name: "design_document",
    input: { action: "update", id: designID, input },
  },
})

describe("design_document update", () => {
  tool.effect("opens its result with what became of the statuses, ahead of the document", () =>
    Effect.gen(function* () {
      amended.length = 0
      const registry = yield* Tool.Service
      const notes = [{ feedback: "msg_nine", index: 1, status: "resolved" as const, evidence: { job: "render_9" } }]
      const text = (result: { content?: ReadonlyArray<Tool.Content> }) =>
        (result.content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

      const recorded = yield* executeTool(registry, update({ notes }))
      expect(recorded.status).toBe("completed")
      expect(recorded.output).toEqual([reviewed])
      expect(text(recorded)).toStartWith(`${report}\n\nDesign design_document: Clients\n`)
      expect(text(recorded)).toContain(
        "Feedback rounds: round 8 (answered by rev_two): 1 open; round 9 (awaiting a revision)",
      )

      // An update that carries no status says nothing about notes.
      const plain = yield* executeTool(registry, update({ questions: ["Which secret?"] }))
      expect(text(plain)).toStartWith("Design design_document: Clients\n")
      expect(text(plain)).not.toContain("Notes: recorded")
      expect(text(plain)).not.toContain("Still without an outcome")

      // Addressed marks go to the store as given and are told with what every round still waits for.
      const addressed = [{ feedback: "msg_nine", index: 2, summary: "Shortened the label" }]
      const marked = yield* executeTool(registry, update({ addressed }))
      expect(marked.status).toBe("completed")
      expect(text(marked)).toStartWith(
        "Addressed: marked 1, ignored 0, refused 0.\nRound 9: 2 of 4 addressed, 2 recorded. Still without an outcome:\n",
      )
      expect(amended).toEqual([{ notes }, { questions: ["Which secret?"] }, { addressed }])
    }),
  )
})
