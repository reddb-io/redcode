/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { Part } from "@reddb-io/redcode-sdk/v2"
import { responseRepairIssues, responseRevisions, ResponseRevisionNote } from "../../src/routes/session/response-repair"
import { mountDialog } from "../fixture/dialog"
import { wait } from "../cli/cmd/tui/sync-fixture"
import { tmpdir } from "../fixture/fixture"

const text = (id: string, messageID: string, value: string, extra: Record<string, unknown> = {}) =>
  ({ id, sessionID: "ses", messageID, type: "text", text: value, ...extra }) as Part
const repair = (id: string, issues: string[]) =>
  text(`${id}-part`, id, "[system:response-quality-repair]", {
    synthetic: true,
    metadata: { responseRepair: { issues } },
  })

const messages = [
  { id: "user", role: "user" },
  { id: "answer", role: "assistant" },
  { id: "repair", role: "user" },
  { id: "revision", role: "assistant" },
]
const parts = {
  user: [text("p1", "user", "teste")],
  answer: [text("p2", "answer", "Olá! Funcionando. Em que posso ajudar?")],
  repair: [repair("repair", ["unsupported"])],
  revision: [text("p4", "revision", "Olá! Em que posso ajudar?")],
}

test("a repaired answer folds into its revision, which carries the revision note", () => {
  const revisions = responseRevisions(messages, parts)
  expect([...revisions.superseded]).toEqual(["answer"])
  expect([...revisions.notes]).toEqual([["revision", { issues: ["unsupported"], originals: ["answer"] }]])
  expect(revisions.pending.size).toBe(0)
  expect(responseRepairIssues({ responseRepair: { issues: ["omission"] } })).toEqual(["omission"])
})

test("a second repair extends the same reply and the note lands on the last answer", () => {
  const revisions = responseRevisions(
    [...messages, { id: "repair-2", role: "user" }, { id: "final", role: "assistant" }, { id: "next", role: "user" }],
    {
      ...parts,
      "repair-2": [repair("repair-2", ["omission", "unsupported"])],
      final: [text("p5", "final", "Pronto.")],
      next: [text("p6", "next", "another question")],
    },
  )
  expect([...revisions.superseded]).toEqual(["answer", "revision"])
  expect([...revisions.notes]).toEqual([
    ["final", { issues: ["unsupported", "omission"], originals: ["answer", "revision"] }],
  ])
})

test("an unanswered repair keeps its answer visible until the revision starts", () => {
  const revisions = responseRevisions(messages.slice(0, 3), parts)
  expect(revisions.superseded.size).toBe(0)
  expect(revisions.notes.size).toBe(0)
  expect([...revisions.pending]).toEqual(["repair"])
})

test("an answer followed by a real prompt or another synthetic note is not revised", () => {
  const prompt = responseRevisions(messages, { ...parts, repair: [text("p3", "repair", "next question")] })
  expect(prompt.superseded.size).toBe(0)
  expect(prompt.notes.size).toBe(0)
  const stopLoss = responseRevisions(messages, {
    ...parts,
    repair: [text("p3", "repair", "keep going", { synthetic: true, metadata: { stopLoss: {} } })],
  })
  expect(stopLoss.superseded.size).toBe(0)
  expect(responseRepairIssues(undefined)).toBeUndefined()
  expect(responseRepairIssues({ responseRepair: "omission" })).toBeUndefined()
})

test("the revision note follows the final answer and opens the original on demand", async () => {
  await using tmp = await tmpdir()
  function Reply() {
    return (
      <>
        <text>Olá! Em que posso ajudar?</text>
        <ResponseRevisionNote issues={["unsupported"]}>
          <text>Thinking: the user greets</text>
          <text>Olá! Funcionando. Em que posso ajudar?</text>
        </ResponseRevisionNote>
        <input id="prompt" placeholder="Continue the conversation" focused />
      </>
    )
  }
  const setup = await mountDialog({ root: tmp.path, children: () => <Reply /> })
  try {
    await wait(() => !!setup.renderer.currentFocusedEditor)
    await setup.renderOnce()
    const screen = setup.captureCharFrame()
    const note = "↻ revised after S1 review (unsupported) · show original"
    expect(screen).toContain(note)
    expect(screen.indexOf("Olá! Em que posso ajudar?")).toBeLessThan(screen.indexOf(note))
    expect(screen).not.toContain("Funcionando")
    expect(screen).not.toContain("the user greets")
    const lines = screen.split("\n")
    const row = lines.findIndex((line) => line.includes("show original"))
    await setup.mockMouse.click(lines[row]!.indexOf("show original") + 1, row)
    await setup.renderOnce()
    const opened = setup.captureCharFrame()
    expect(opened).toContain("hide original")
    expect(opened).toContain("the user greets")
    expect(opened.indexOf("hide original")).toBeLessThan(opened.indexOf("Olá! Funcionando. Em que posso ajudar?"))
  } finally {
    setup.renderer.destroy()
  }
})
