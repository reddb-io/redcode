import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionTodo } from "../src/session-todo.js"

const graphemes = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text))

describe("SessionTodo.label", () => {
  test("prefers the model's title and keeps it on one line", () => {
    expect(SessionTodo.label({ title: "  Corrigir o login  ", content: "Texto completo da tarefa" })).toBe(
      "Corrigir o login",
    )
    expect(SessionTodo.label({ title: "Revisar\ncódigo", content: "x" })).toBe("Revisar")
  })

  test("derives the first non-blank line of the content with collapsed whitespace", () => {
    expect(SessionTodo.label({ content: "\n\n   Revisar   o\tcódigo  \nmais detalhes" })).toBe("Revisar o código")
    expect(SessionTodo.label({ title: "   ", content: "Ajustar a validação\nDetalhes" })).toBe("Ajustar a validação")
  })

  test("cuts a long line at its first sentence when that sentence fits", () => {
    expect(SessionTodo.label({ content: `Corrigir a sessão. ${"Depois validar tudo ".repeat(10)}` })).toBe(
      "Corrigir a sessão.",
    )
    expect(SessionTodo.label({ content: `修复登录页面的错误。${"测".repeat(100)}` })).toBe("修复登录页面的错误。")
  })

  test("does not take a file name for a sentence end", () => {
    expect(SessionTodo.label({ content: `Update todo.ts and ${"x".repeat(100)}` })).toBe(
      `Update todo.ts and ${"x".repeat(60)}…`,
    )
  })

  test("cuts long unbroken text on grapheme boundaries", () => {
    expect(SessionTodo.label({ content: "a".repeat(1500) })).toBe(`${"a".repeat(79)}…`)
    expect(SessionTodo.label({ content: "🚀".repeat(100) })).toBe(`${"🚀".repeat(79)}…`)
    expect(SessionTodo.label({ content: "👨‍👩‍👧".repeat(90) })).toBe(`${"👨‍👩‍👧".repeat(79)}…`)
    // A decomposed accent is one grapheme of two code points and is never split from its letter.
    expect(SessionTodo.label({ content: "é".repeat(100) })).toBe(`${"é".repeat(79)}…`)
  })

  test("keeps a 1500-character task to the label limit", () => {
    const content = `Revisar a exportação do relatório com acentuação, 日本語 e emoji 🚀 ${"sem pontuação ".repeat(110)}`
    expect(content.length).toBeGreaterThan(1500)
    expect(graphemes(SessionTodo.label({ content })).length).toBeLessThanOrEqual(SessionTodo.TITLE_LIMIT)
  })
})

describe("SessionTodo.ModelInput", () => {
  const decode = Schema.decodeUnknownSync(SessionTodo.ModelInput)

  test("keeps a title next to content as the short label", () => {
    expect(decode({ content: "Texto completo", title: "Curto", priority: "high" })).toEqual({
      content: "Texto completo",
      title: "Curto",
      priority: "high",
    })
    expect(decode({ text: "Texto completo", title: "Curto" })).toEqual({ content: "Texto completo", title: "Curto" })
  })

  test("still folds a title without content into content", () => {
    expect(decode({ title: "Tarefa", priority: "high" })).toEqual({ content: "Tarefa", priority: "high" })
    expect(decode({ content: "", title: "Tarefa" })).toEqual({ content: "Tarefa" })
    expect(decode({ title: "Tarefa", task: "Outra" })).toEqual({ content: "Tarefa" })
  })

  test("leaves an update by id without content untouched", () => {
    expect(decode({ id: "todo_1", status: "completed" })).toEqual({ id: "todo_1", status: "completed" })
  })
})
