import { expect, test } from "bun:test"
import { Schema } from "effect"
import { DesignDocumentTool } from "../src/design/document-tool"

test("Design document keeps every operation and its payload through decoding", () => {
  const inputs: unknown[] = [
    { action: "list" },
    {
      action: "create",
      input: { name: "Dark mode", journey: "existing", engine: "react", kind: "screen", application: "apps/admin" },
    },
    { action: "update", id: "design_fixture", input: { questions: ["Which theme?"], entry: "src/main.tsx" } },
    { action: "reopen", id: "design_fixture" },
    { action: "refresh", id: "design_fixture" },
  ]
  inputs.forEach((input) => expect(input).toEqual(Schema.decodeUnknownSync(DesignDocumentTool.Input)(input)))
})

test("Design document rejects missing actions and incomplete conditional arguments", () => {
  const inputs = [
    {},
    { action: "unknown" },
    { action: "create" },
    { action: "create", input: {} },
    { action: "create", input: { name: "Dark mode", journey: "existing", engine: "react" } },
    { action: "create", input: { name: "", journey: "existing", engine: "react", kind: "screen" } },
    { action: "update", input: {} },
    { action: "update", id: "design_fixture" },
    { action: "update", id: "design_fixture", input: { questions: [42] } },
    { action: "reopen" },
    { action: "refresh" },
    { action: "refresh", id: "invalid" },
  ]
  inputs.forEach((input) => expect(() => Schema.decodeUnknownSync(DesignDocumentTool.Input)(input)).toThrow())
})
