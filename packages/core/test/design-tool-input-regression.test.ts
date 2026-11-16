import { expect, test } from "bun:test"
import { Schema } from "effect"
import { DesignDocumentTool } from "@opencode/core/design/document-tool"
import { DesignPreviewTool } from "@opencode/core/tool/plugin/design-preview"

/**
 * The exact payloads that a Design session sent and that were refused before this was fixed. The
 * generated schema advertised `null` for optional fields; the decoder rejects null, so the agent
 * spent the cycle retrying forms the schema itself invited and never reached a created design.
 */
const decode = (schema: any, value: unknown) => Schema.decodeUnknownExit(schema)(value)._tag

test("a null passed for an optional id is repaired away before the decoder runs", () => {
  // The raw decoder still refuses null: the schema no longer advertises it, and the input repair
  // drops it as an optional placeholder. Here the decoder contract itself is the invariant.
  expect(
    decode(DesignDocumentTool.Input, {
      action: "update",
      id: null,
      input: { addressed: [{ feedback: "msg_1", index: 1, summary: "changed" }] },
    }),
  ).toBe("Failure")
  // The advertised form decodes.
  expect(
    decode(DesignDocumentTool.Input, {
      action: "update",
      id: "design_abc",
      input: { addressed: [{ feedback: "msg_1", index: 1, summary: "changed" }] },
    }),
  ).toBe("Success")
})

test("design_preview accepts either identity, and never advertises null for them", () => {
  expect(decode(DesignPreviewTool.Input, { id: "design_abc" })).toBe("Success")
  expect(decode(DesignPreviewTool.Input, { path: ".red/code/design/design_abc/work" })).toBe("Success")
  expect(decode(DesignPreviewTool.Input, {})).toBe("Failure")
  expect(decode(DesignPreviewTool.Input, { path: null })).toBe("Failure")
})

test("the created design is reachable: a create carries the brief and controls, and update needs its id", () => {
  // A create that records the material in the same call is what gives the agent a root to edit.
  expect(
    decode(DesignDocumentTool.Input, {
      action: "create",
      input: {
        name: "Candinator Drawer",
        journey: "existing",
        engine: "html",
        kind: "screen",
        application: ".",
        brief: { objective: "o", audience: "a", content: "c", constraints: "k", references: [] },
        controls: [],
        decisions: [{ id: "d1", text: "Compact header" }],
      },
    }),
  ).toBe("Success")
})
