import { expect, test } from "bun:test"
import { LLMEvent } from "@opencode/ai"
import { SessionOutputGuard } from "@opencode/core/session/output-guard"

const header = "<tool_call>design_document<arg_key>designSystem</arg_key><arg_value>"

test("stops raw GLM tool calls before the argument body, regardless of chunk boundaries", () => {
  for (const size of [1, 2, 7, header.length]) {
    const guard = SessionOutputGuard.make(["design_document"])
    const results = Array.from({ length: Math.ceil(header.length / size) }, (_, index) =>
      guard.observe(LLMEvent.textDelta({ id: "answer", text: header.slice(index * size, (index + 1) * size) })),
    )
    expect(results.filter(Boolean)).toEqual(["design_document"])
  }
})

test("handles multiline headers and complete text values", () => {
  const guard = SessionOutputGuard.make(["design_document"])
  expect(
    guard.observe(
      LLMEvent.textEnd({
        id: "answer",
        text: "<tool_call>\ndesign_document\n<arg_key>designSystem</arg_key>\n<arg_value>",
      }),
    ),
  ).toBe("design_document")
})

test("allows code examples, quotes, indented code, ordinary XML and unknown tool names", () => {
  for (const text of [
    `\`\`\`xml\n${header}\n\`\`\``,
    `~~~xml\n${header}\n~~~`,
    `> ${header}`,
    `    ${header}`,
    `\t${header}`,
    `The format is \`${header}\`.`,
    `<article><title>Profile</title></article>`,
    header.replace("design_document", "unknown"),
  ]) {
    const guard = SessionOutputGuard.make(["design_document"])
    for (const character of text)
      expect(guard.observe(LLMEvent.textDelta({ id: "answer", text: character }))).toBeUndefined()
  }
})

test("does not reinterpret reasoning or native tool arguments", () => {
  const guard = SessionOutputGuard.make(["design_document"])
  expect(guard.observe(LLMEvent.reasoningDelta({ id: "thought", text: header }))).toBeUndefined()
  expect(guard.observe(LLMEvent.toolInputDelta({ id: "call", name: "design_document", text: header }))).toBeUndefined()
  expect(
    guard.observe(LLMEvent.toolCall({ id: "call", name: "design_document", input: { designSystem: header } })),
  ).toBeUndefined()
  expect(SessionOutputGuard.make([]).observe(LLMEvent.textDelta({ id: "answer", text: header }))).toBeUndefined()
})

test("detects leaks after a closed code fence and ignores headers split across distinct text parts", () => {
  const guard = SessionOutputGuard.make(["design_document"])
  expect(guard.observe(LLMEvent.textDelta({ id: "answer", text: `\`\`\`xml\n${header}\n\`\`\`\n${header}` }))).toBe(
    "design_document",
  )
  const separate = SessionOutputGuard.make(["design_document"])
  expect(separate.observe(LLMEvent.textDelta({ id: "first", text: "<tool_call>design_document" }))).toBeUndefined()
  separate.observe(LLMEvent.textStart({ id: "second" }))
  expect(
    separate.observe(LLMEvent.textDelta({ id: "second", text: "<arg_key>designSystem</arg_key><arg_value>" })),
  ).toBeUndefined()
})
