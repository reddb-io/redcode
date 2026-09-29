/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { SidebarTodo } from "../../src/feature-plugins/sidebar/todo"

const content = `Revisar a exportação do relatório, 日本語 e 🚀. ${"Cada linha exportada precisa de data, valor e moeda corretos. ".repeat(24)}FIM`

function context(todos: ReadonlyArray<Record<string, unknown>>) {
  const color = RGBA.fromInts(200, 200, 200)
  return {
    theme: {
      text: {
        base: color,
        muted: color,
        action: { primary: { base: color }, secondary: { base: color } },
        feedback: { warning: { base: color }, error: { base: color } },
      },
    },
    client: { session: { todo: { list: async () => todos } } },
  } as unknown as Context
}

async function settle(app: Awaited<ReturnType<typeof testRender>>, ready: (frame: string) => boolean) {
  for (let attempt = 0; attempt < 50 && !ready(app.captureCharFrame()); attempt++) {
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
    expect(rows[1]).toContain("[•] Revisar a exportação")
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
