import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { DesignDocumentTool } from "../src/design/document-tool"

const decode = Schema.decodeUnknownSync(DesignDocumentTool.Input)

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
      { action: "reopen", id: "design_fixture" },
      { action: "refresh", id: "design_fixture" },
      { action: "detect" },
      { action: "detect", input: { application: "apps/web" } },
    ]
    inputs.forEach((input) => expect(decode(input)).toEqual(input))
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
      { action: "reopen" },
      { action: "refresh" },
      { action: "refresh", id: "invalid" },
    ]
    inputs.forEach((input) => expect(() => decode(input)).toThrow())
  })
})
