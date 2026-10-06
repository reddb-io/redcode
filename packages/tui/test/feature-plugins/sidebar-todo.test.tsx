/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import type { DesignInfo, DesignNote } from "@opencode/client"
import { SidebarTodo } from "../../src/feature-plugins/sidebar/todo"

const content = `Revisar a exportação do relatório, 日本語 e 🚀. ${"Cada linha exportada precisa de data, valor e moeda corretos. ".repeat(24)}FIM`

function context(
  todos: ReadonlyArray<Record<string, unknown>>,
  options: { agent?: string; designs?: () => ReadonlyArray<DesignInfo> } = {},
) {
  const color = RGBA.fromInts(200, 200, 200)
  return {
    data: { session: { get: () => ({ agent: options.agent ?? "build" }) } },
    theme: {
      text: {
        base: color,
        muted: color,
        action: { primary: { base: color }, secondary: { base: color } },
        feedback: { warning: { base: color }, error: { base: color } },
      },
    },
    client: {
      session: {
        todo: { list: async () => todos },
        design: {
          list: async () => options.designs?.() ?? [],
          // Newest first, as the server lists them: revision_2 is R2.
          revisions: async () => [{ id: "revision_2" }, { id: "revision_1" }],
        },
      },
    },
  } as unknown as Context
}

async function settle(app: Awaited<ReturnType<typeof testRender>>, ready: (frame: string) => boolean, timeout = 500) {
  for (let attempt = 0; attempt < timeout / 10 && !ready(app.captureCharFrame()); attempt++) {
    await Bun.sleep(10)
    await app.renderOnce()
  }
  return app.captureCharFrame()
}

test("sidebar keeps a 1500-character task to its title line and expands it on click", async () => {
  expect(content.length).toBeGreaterThan(1500)
  const app = await testRender(
    () => (
      <SidebarTodo
        context={context([
          {
            id: "todo_long",
            content,
            criterion: "O relatório exportado contém todas as linhas",
            status: "in_progress",
            priority: "high",
          },
          {
            id: "todo_blocked",
            title: "Confirmar com o revisor",
            content: "Confirmar o contrato com o revisor antes de publicar",
            status: "blocked",
            priority: "medium",
            reason: `Aguardando resposta do revisor sobre o contrato.\n${"detalhe ".repeat(200)}`,
          },
        ])}
        sessionID="session"
      />
    ),
    { width: 42, height: 120 },
  )

  try {
    const collapsed = await settle(app, (frame) => frame.includes("[•]"))
    const rows = collapsed.split("\n").filter((line) => line.trim())
    // Header, one title line per task and one reason line for the blocked task.
    expect(rows).toHaveLength(4)
    // Text rows cut in the middle, so the start of the title and its end stay visible.
    expect(rows[1]).toContain("[•] Revisar a exporta")
    expect(rows[2]).toContain("[!] Confirmar com o revisor")
    expect(rows[3]).toContain("Aguardando resposta")
    expect(collapsed).not.toContain("FIM")
    expect(collapsed).not.toContain("detalhe")

    await app.mockMouse.click(
      6,
      collapsed.split("\n").findIndex((line) => line.includes("[•]")),
    )
    const expanded = await settle(app, (frame) => frame.includes("FIM"))
    expect(expanded).toContain("FIM")
    expect(expanded).toContain("Done when: O relatório exportado")
    expect(expanded.split("\n").filter((line) => line.trim()).length).toBeGreaterThan(20)
  } finally {
    app.renderer.destroy()
  }
})

function note(round: number, index: number, item: Partial<DesignNote["item"]>, mark: Partial<DesignNote> = {}) {
  return {
    feedback: `feedback_${round}`,
    index,
    round,
    item: { target: `[data-design-id="n${index}"]`, text: "", ...item },
    status: "open",
    updated: 1,
    ...mark,
  } satisfies DesignNote
}

function design(notes: ReadonlyArray<DesignNote>, extra: Partial<DesignInfo> = {}) {
  return {
    id: "design_checkout",
    name: "Checkout",
    revision: "revision_2",
    approvedRevision: null,
    ended: false,
    rounds: [...new Set(notes.map((item) => item.round))]
      .toSorted((a, b) => a - b)
      .map((number) => ({
        number,
        opened: 1,
        revision: "revision_1",
        feedback: [`feedback_${number}`],
      })),
    notes,
    ...extra,
  } as DesignInfo
}

const addressed = { addressed: { summary: "Changed it", at: 2 } }

// Round 9: notes 1-3 recorded (the mark stays), 4-8 marked addressed, 9-14 left without either.
const round9 = Array.from({ length: 14 }, (_, position) => {
  const index = position + 1
  if (index <= 3) return note(9, index, { text: `Feito ${index}` }, { ...addressed, status: "resolved" })
  if (index <= 8) return note(9, index, { text: `Marcado ${index}` }, addressed)
  if (index === 9)
    return note(9, index, {
      tag: "button",
      elementText: "Rotacionar secret",
      label: 'button "Rotacionar secret" in dialog "Segredos"',
      text: "Trocar o ícone\n  e o texto do botão",
    })
  if (index === 10) return note(9, index, { label: 'svg in button "Fechar"', text: "アイコンを大きく 🚀" })
  return note(9, index, { text: `Resto ${index} ${"palavra ".repeat(40)}` })
})

test("Design round shows its counts and the first three notes still without a mark", async () => {
  const app = await testRender(
    () => (
      <SidebarTodo
        context={context([], {
          agent: "design",
          designs: () => [
            design([...round9, note(8, 1, { text: "Antiga" }, { status: "accepted", reason: "ok" })]),
            design([note(3, 1, { text: "Encerrada" })], { id: "design_ended", name: "Ended", ended: true }),
          ],
        })}
        sessionID="session"
      />
    ),
    // The session sidebar's content column.
    { width: 37, height: 40 },
  )

  try {
    const frame = await settle(app, (frame) => frame.includes("Round 9") && frame.includes("R2"))
    const rows = frame.split("\n").filter((line) => line.trim())
    // Two designs are listed, so the review names its design and the revision it is on; the ended review
    // shows nothing.
    expect(rows[0]).toContain("Design review · Checkout · R2")
    // Wrapped rather than losing a count.
    expect(rows[1]).toContain("Round 9 · 8/14 addressed")
    expect(frame).toContain("3 recorded")
    // The element is held to a few cells so the user's words keep the rest of the row.
    expect(frame).toContain('[ ] button "Rotaci…": Trocar')
    expect(frame).toContain('[ ] svg in button "…: アイ')
    expect(frame).toContain("[ ] [data-design-id…: Resto")
    expect(frame).toContain("+3 more without a mark")
    // One line per note, however long the words.
    expect(frame).not.toContain("Resto 12")
    // An older answered round is not the newest one, so it stays out of the sidebar.
    expect(frame).not.toContain("Round 8")
    expect(frame).not.toContain("Encerrada")
    expect(frame).not.toContain("Todo ·")
  } finally {
    app.renderer.destroy()
  }
})

test("Design round follows the sidebar poll and stays as its outcomes once every note has one", async () => {
  const notes = [note(9, 1, { tag: "a", elementText: "Ajuda", text: "Link quebrado" }), note(9, 2, { text: "Cor" })]
  const state = { designs: [design(notes)] }
  const app = await testRender(
    () => (
      <SidebarTodo
        context={context(
          [
            { id: "todo_setup", content: "Aprovar o protótipo", status: "pending", priority: "high", phase: "design" },
            {
              id: "todo_slop",
              content: "Rodar o anti-slop",
              status: "completed",
              priority: "high",
              phase: "design",
              closedAt: Date.now(),
            },
          ],
          { agent: "design", designs: () => state.designs },
        )}
        sessionID="session"
      />
    ),
    { width: 60, height: 40 },
  )

  try {
    const first = await settle(app, (frame) => frame.includes("Round 9") && frame.includes("R2"))
    expect(first).toContain("Design review · R2")
    expect(first).toContain("Round 9 · 0/2 addressed · 0 recorded")
    expect(first).not.toContain("Checkout")
    expect(first).toContain('[ ] a "Ajuda": Link quebrado')
    expect(first).toContain("[ ] [data-design-id…: Cor")
    // The Design tasks fold into one line under their own header while the review has rounds.
    expect(first).toContain("Todo · Design")
    expect(first).toContain("▶ Design tasks · 1 open · 1 done")
    expect(first).not.toContain("Aprovar o protótipo")

    const rows = first.split("\n")
    await app.mockMouse.click(
      4,
      rows.findIndex((line) => line.includes("Design tasks")),
    )
    const unfolded = await settle(app, (frame) => frame.includes("Aprovar o protótipo"))
    expect(unfolded).toContain("▼ Design tasks")
    expect(unfolded).toContain("[ ] Aprovar o protótipo")
    expect(unfolded).toContain("[✓] Rodar o anti-slop")

    state.designs = [design([{ ...notes[0], ...addressed }, notes[1]])]
    const marked = await settle(app, (frame) => frame.includes("1/2 addressed"), 8_000)
    expect(marked).not.toContain("Link quebrado")
    expect(marked).toContain("Cor")

    state.designs = [
      design([
        { ...notes[0], ...addressed, status: "resolved" },
        { ...notes[1], status: "unresolved", reason: "Fora do escopo" },
      ]),
    ]
    const settled = await settle(app, (frame) => frame.includes("1 resolved"), 8_000)
    // The answered round stays as one line of tallies, with the note that was not fixed under it.
    expect(settled).toContain("Round 9 · 1 resolved · 1 unresolved")
    expect(settled).toContain("[✗] [data-design-id…: Cor")
    expect(settled).not.toContain("Link quebrado")
    expect(settled).not.toContain("addressed")
  } finally {
    app.renderer.destroy()
  }
}, 25_000)

test("An answered round lists its partial and unresolved notes and a requested end is named", async () => {
  const outcomes = [
    ...Array.from({ length: 12 }, (_, position) =>
      note(3, position + 1, { text: `Feito ${position + 1}` }, { status: "resolved" }),
    ),
    note(3, 13, { text: "Quase" }, { status: "partial", reason: "Falta o hover" }),
    ...Array.from({ length: 4 }, (_, position) =>
      note(3, 14 + position, { text: `Aberto ${position + 1}` }, { status: "unresolved", reason: "Depois" }),
    ),
  ]
  const app = await testRender(
    () => (
      <SidebarTodo
        context={context([], { designs: () => [design(outcomes, { endRequested: true })] })}
        sessionID="session"
      />
    ),
    { width: 60, height: 30 },
  )

  try {
    const frame = await settle(app, (frame) => frame.includes("Round 3") && frame.includes("R2"))
    const rows = frame.split("\n").filter((line) => line.trim())
    expect(rows[0]).toContain("Design review · R2 · ending after this round")
    expect(rows[1]).toContain("Round 3 · 12 resolved · 1 partial · 4 unresolved")
    expect(rows[2]).toContain("[~] [data-design-id…: Quase")
    expect(rows[3]).toContain("[✗] [data-design-id…: Aberto 1")
    expect(rows[4]).toContain("[✗] [data-design-id…: Aberto 2")
    expect(rows[5]).toContain("+2 more partial or unresolved")
    expect(rows).toHaveLength(6)
    expect(frame).not.toContain("Feito")
  } finally {
    app.renderer.destroy()
  }
})

test("A round with every note marked addressed still shows until the outcomes are recorded", async () => {
  const app = await testRender(
    () => (
      <SidebarTodo
        context={context([], { designs: () => [design([note(4, 1, { text: "Feito" }, addressed)])] })}
        sessionID="session"
      />
    ),
    { width: 60, height: 20 },
  )

  try {
    const frame = await settle(app, (frame) => frame.includes("Round 4"))
    const rows = frame.split("\n").filter((line) => line.trim())
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain("Design review")
    expect(rows[1]).toContain("Round 4 · 1/1 addressed · 0 recorded")
  } finally {
    app.renderer.destroy()
  }
})
