import { describe, expect, test } from "bun:test"
import { normalizeTool, toolInlineInfo, toolOutputText, toolPath, toolScroll } from "../../src/mini/tool"
import { canonicalToolPart } from "./fixture/tool-part"

describe("Mini tool presentation", () => {
  test("uses V2 shell output without the model-facing status", () => {
    expect(
      toolOutputText("shell", [
        { type: "text", text: "mini-output\n" },
        { type: "text", text: "Command exited with code 0." },
      ]),
    ).toBe("mini-output\n")

    expect(
      toolOutputText("shell", [
        { type: "text", text: "" },
        { type: "text", text: "Command exited with code 0." },
      ]),
    ).toBe("")
  })

  test("normalizes only persisted tool aliases into current fields", () => {
    expect(
      normalizeTool({
        type: "tool",
        id: "call-patch",
        name: "apply_patch",
        state: {
          status: "completed",
          input: { patchText: "*** Begin Patch\n*** End Patch" },
          metadata: {
            files: [
              {
                type: "update",
                filePath: "/tmp/project/src/a.ts",
                relativePath: "src/a.ts",
                patch: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
          },
          content: [{ type: "text", text: "patched" }],
        },
        time: { created: 1, ran: 1, completed: 2 },
      }),
    ).toMatchObject({
      name: "patch",
      state: {
        metadata: {
          files: [
            {
              status: "modified",
              file: "src/a.ts",
              patch: "@@ -1 +1 @@\n-old\n+new",
            },
          ],
        },
        content: [{ type: "text", text: "patched" }],
      },
    })

    expect(
      normalizeTool({
        type: "tool",
        id: "call-subagent",
        name: "task",
        state: {
          status: "running",
          input: { subagent_type: "explore", description: "Inspect" },
          metadata: {},
        },
        time: { created: 1, ran: 1 },
      }),
    ).toMatchObject({ name: "subagent", state: { input: { agent: "explore" } } })
  })

  test("renders the skill name from tool metadata with the input id as fallback", () => {
    const skill = (metadata: { name?: string }) =>
      canonicalToolPart(
        "skill",
        {
          status: "completed",
          input: { id: "tigerstyle" },
          metadata,
          content: [{ type: "text", text: "" }],
        },
        "call-skill",
      )

    expect(toolInlineInfo(skill({ name: "effect" })).title).toBe('Skill "effect"')
    expect(toolInlineInfo(skill({})).title).toBe('Skill "tigerstyle"')
    expect(
      toolScroll("start", {
        directory: "/work/project",
        raw: "",
        name: "skill",
        input: { id: "tigerstyle" },
        meta: { name: "effect" },
        state: {},
        status: "completed",
        error: "",
        output: "",
        time: {},
      }),
    ).toBe('→ Skill "effect"')
  })

  test("names task updates by their short labels on one bounded line", () => {
    const todo = (todos: ReadonlyArray<Record<string, string>>) =>
      toolInlineInfo(
        canonicalToolPart("todowrite", {
          status: "completed",
          input: { todos: [...todos] },
          metadata: {},
          content: [{ type: "text", text: "{}" }],
        }),
      ).title

    expect(
      todo([
        { title: "Exportar relatório", content: "Exportar o relatório completo com todas as linhas" },
        { id: "todo_2", status: "completed" },
      ]),
    ).toBe("Tasks Exportar relatório · todo_2 completed")
    expect(todo([{ content: "a".repeat(1500) }])).toBe(`Tasks ${"a".repeat(79)}…`)
    expect(todo(Array.from({ length: 5 }, (_, index) => ({ content: `${index}`.repeat(1500) }))).length).toBeLessThanOrEqual(160)
    expect(todo([])).toBe("Read tasks")
  })

  test("renders compact search metadata", () => {
    expect(
      toolInlineInfo(
        canonicalToolPart("glob", {
          status: "completed",
          input: { pattern: "*.ts" },
          metadata: { count: 3 },
          content: [{ type: "text", text: "" }],
        }),
      ).description,
    ).toBe("3 matches")
    expect(
      toolInlineInfo(
        canonicalToolPart("grep", {
          status: "completed",
          input: { pattern: "needle" },
          metadata: { matches: 1 },
          content: [{ type: "text", text: "" }],
        }),
      ).description,
    ).toBe("1 match")
  })

  test("keeps segment-safe contained tool paths relative", () => {
    expect(toolPath("..cache/result.txt", { directory: "/work/project" })).toBe("..cache/result.txt")
    expect(toolPath("../shared/result.txt", { directory: "/work/project" })).toBe("/work/shared/result.txt")
  })
})
