import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { ToolJsonSchema } from "../../src/tool/json-schema"

// Each tool exports its parameters schema at module scope so this test can
// import them without running the tool's Effect-based init. The JSON Schema
// snapshot captures what the LLM sees; the parse assertions pin down the
// accepts/rejects contract. `ToolJsonSchema.fromSchema` is the same helper `session/
// prompt.ts` uses to emit tool schemas to the LLM, so the snapshots stay
// provider-compatible while tools use Effect Schema internally.

import { Parameters as ApplyPatch } from "../../src/tool/apply_patch"
import { Parameters as Edit } from "../../src/tool/edit"
import { Parameters as Glob } from "../../src/tool/glob"
import { Parameters as Grep } from "../../src/tool/grep"
import { Parameters as Invalid } from "../../src/tool/invalid"
import { Parameters as Lsp } from "../../src/tool/lsp"
import { PlanParameters } from "../../src/tool/plan"
import { Parameters as Question } from "../../src/tool/question"
import { Parameters as Read } from "../../src/tool/read"
import { Parameters as Shell } from "../../src/tool/shell"
import { Parameters as Skill } from "../../src/tool/skill"
import { Parameters as Task } from "../../src/tool/task"
import { ModelParameters as TodoModel, Parameters as Todo } from "../../src/tool/todo"
import { Parameters as WebFetch } from "../../src/tool/webfetch"
import { Parameters as WebSearch } from "../../src/tool/websearch"
import { Parameters as Write } from "../../src/tool/write"
import { DesignDocumentTool } from "@reddb-io/redcode-core/design/document-tool"

const parse = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown): S["Type"] =>
  Schema.decodeUnknownSync(schema)(input)

const accepts = (schema: Schema.Decoder<unknown>, input: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(input))

const toJsonSchema = ToolJsonSchema.fromSchema

describe("tool parameters", () => {
  describe("JSON Schema (wire shape)", () => {
    test("apply_patch", () => expect(toJsonSchema(ApplyPatch)).toMatchSnapshot())
    test("bash", () => expect(toJsonSchema(Shell)).toMatchSnapshot())
    test("edit", () => expect(toJsonSchema(Edit)).toMatchSnapshot())
    test("glob", () => expect(toJsonSchema(Glob)).toMatchSnapshot())
    test("grep", () => expect(toJsonSchema(Grep)).toMatchSnapshot())
    test("invalid", () => expect(toJsonSchema(Invalid)).toMatchSnapshot())
    test("lsp", () => expect(toJsonSchema(Lsp)).toMatchSnapshot())
    test("plan", () => expect(toJsonSchema(PlanParameters)).toMatchSnapshot())
    test("question", () => expect(toJsonSchema(Question)).toMatchSnapshot())
    test("read", () => expect(toJsonSchema(Read)).toMatchSnapshot())
    test("skill", () => expect(toJsonSchema(Skill)).toMatchSnapshot())
    test("task", () => expect(toJsonSchema(Task)).toMatchSnapshot())
    test("todo", () => expect(toJsonSchema(Todo)).toMatchSnapshot())
    test("todo aliases are decoded but never advertised", () => {
      expect(toJsonSchema(TodoModel)).toHaveProperty("properties.todos.items.properties.text")
      expect(toJsonSchema(Todo)).not.toHaveProperty("properties.todos.items.properties.text")
      expect(
        Schema.decodeUnknownSync(TodoModel)({ todos: [{ title: "x", status: "pending", priority: "low" }] }),
      ).toEqual({
        todos: [{ content: "x", status: "pending", priority: "low" }],
      })
    })
    test("webfetch", () => expect(toJsonSchema(WebFetch)).toMatchSnapshot())
    test("websearch", () => expect(toJsonSchema(WebSearch)).toMatchSnapshot())
    test("write", () => expect(toJsonSchema(Write)).toMatchSnapshot())
    test("design_document", () => expect(toJsonSchema(DesignDocumentTool.Input)).toMatchSnapshot())
    test("design_document accepts detect and still decodes every action", () => {
      expect(toJsonSchema(DesignDocumentTool.Input)).toMatchObject({
        properties: { action: { enum: ["list", "create", "update", "reopen", "refresh", "detect"] } },
      })
      expect(parse(DesignDocumentTool.Input, { action: "detect" })).toEqual({ action: "detect" })
      expect(parse(DesignDocumentTool.Input, { action: "detect", input: { application: "apps/web" } })).toEqual({
        action: "detect",
        input: { application: "apps/web" },
      })
      expect(accepts(DesignDocumentTool.Input, { action: "refresh" })).toBe(false)
    })

    test("inlines named child schemas for provider compatibility", () => {
      const schema = toJsonSchema(Question)
      expect(schema).not.toHaveProperty("$defs")
      expect(schema).toMatchObject({
        properties: {
          questions: { items: { properties: { options: { items: { properties: { label: { type: "string" } } } } } } },
        },
      })
    })

    test("preserves required nullable fields", () => {
      expect(toJsonSchema(Schema.Struct({ value: Schema.NullOr(Schema.String) }))).toMatchObject({
        properties: { value: { anyOf: expect.arrayContaining([{ type: "null" }]) } },
      })
    })

    test("keeps repeated allOf constraints instead of dropping duplicates", () => {
      expect(
        toJsonSchema(
          Schema.Struct({ value: Schema.String.check(Schema.isPattern(/^a/)).check(Schema.isPattern(/z$/)) }),
        ),
      ).toMatchObject({ properties: { value: { allOf: [{ pattern: "^a" }, { pattern: "z$" }] } } })
    })

    test("bounds bare integer fields to safe integer range", () => {
      expect(toJsonSchema(Schema.Struct({ value: Schema.Int }))).toMatchObject({
        properties: { value: { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER } },
      })
    })

    test("does not expose defaulted optional keys as nullable", () => {
      expect(toJsonSchema(WebFetch)).toMatchObject({
        properties: { format: { type: "string", enum: ["text", "markdown", "html"], default: "markdown" } },
      })
      expect(toJsonSchema(WebFetch).properties?.format).not.toHaveProperty("anyOf")
    })
  })

  describe("apply_patch", () => {
    test("accepts patchText", () => {
      expect(parse(ApplyPatch, { patchText: "*** Begin Patch\n*** End Patch" })).toEqual({
        patchText: "*** Begin Patch\n*** End Patch",
      })
    })
    test("rejects missing patchText", () => {
      expect(accepts(ApplyPatch, {})).toBe(false)
    })
    test("rejects non-string patchText", () => {
      expect(accepts(ApplyPatch, { patchText: 123 })).toBe(false)
    })
  })

  describe("shell", () => {
    test("accepts command", () => {
      expect(parse(Shell, { command: "ls" })).toEqual({ command: "ls" })
    })
    test("accepts optional timeout + workdir", () => {
      const parsed = parse(Shell, { command: "ls", timeout: 5000, workdir: "/tmp" })
      expect(parsed.timeout).toBe(5000)
      expect(parsed.workdir).toBe("/tmp")
    })
    test("rejects missing command", () => {
      expect(accepts(Shell, {})).toBe(false)
    })
  })

  describe("edit", () => {
    test("accepts all four fields", () => {
      expect(parse(Edit, { filePath: "/a", oldString: "x", newString: "y", replaceAll: true })).toEqual({
        filePath: "/a",
        oldString: "x",
        newString: "y",
        replaceAll: true,
      })
    })
    test("replaceAll is optional", () => {
      const parsed = parse(Edit, { filePath: "/a", oldString: "x", newString: "y" })
      expect(parsed.replaceAll).toBeUndefined()
    })
    test("rejects missing filePath", () => {
      expect(accepts(Edit, { oldString: "x", newString: "y" })).toBe(false)
    })
  })

  describe("glob", () => {
    test("accepts pattern-only", () => {
      expect(parse(Glob, { pattern: "**/*.ts" })).toEqual({ pattern: "**/*.ts" })
    })
    test("accepts optional path", () => {
      expect(parse(Glob, { pattern: "**/*.ts", path: "/tmp" }).path).toBe("/tmp")
    })
    test("rejects missing pattern", () => {
      expect(accepts(Glob, {})).toBe(false)
    })
  })

  describe("grep", () => {
    test("accepts pattern-only", () => {
      expect(parse(Grep, { pattern: "TODO" })).toEqual({ pattern: "TODO" })
    })
    test("accepts optional path + include", () => {
      const parsed = parse(Grep, { pattern: "TODO", path: "/tmp", include: "*.ts" })
      expect(parsed.path).toBe("/tmp")
      expect(parsed.include).toBe("*.ts")
    })
    test("rejects missing pattern", () => {
      expect(accepts(Grep, {})).toBe(false)
    })
  })

  describe("invalid", () => {
    test("accepts tool + error", () => {
      expect(parse(Invalid, { tool: "foo", error: "bar" })).toEqual({ tool: "foo", error: "bar" })
    })
    test("rejects missing fields", () => {
      expect(accepts(Invalid, { tool: "foo" })).toBe(false)
      expect(accepts(Invalid, { error: "bar" })).toBe(false)
    })
  })

  describe("lsp", () => {
    test("accepts all fields", () => {
      const parsed = parse(Lsp, { operation: "hover", filePath: "/a.ts", line: 1, character: 1 })
      expect(parsed.operation).toBe("hover")
    })
    test("rejects line < 1", () => {
      expect(accepts(Lsp, { operation: "hover", filePath: "/a.ts", line: 0, character: 1 })).toBe(false)
    })
    test("rejects character < 1", () => {
      expect(accepts(Lsp, { operation: "hover", filePath: "/a.ts", line: 1, character: 0 })).toBe(false)
    })
    test("rejects unknown operation", () => {
      expect(accepts(Lsp, { operation: "bogus", filePath: "/a.ts", line: 1, character: 1 })).toBe(false)
    })
  })

  describe("plan", () => {
    test("accepts empty object", () => {
      expect(parse(PlanParameters, {})).toEqual({})
    })
  })

  describe("question", () => {
    test("accepts questions array", () => {
      const parsed = parse(Question, {
        questions: [
          {
            question: "pick one",
            header: "Header",
            custom: false,
            options: [{ label: "a", description: "desc" }],
          },
        ],
      })
      expect(parsed.questions.length).toBe(1)
    })
    test("rejects missing questions", () => {
      expect(accepts(Question, {})).toBe(false)
    })
  })

  describe("read", () => {
    test("accepts filePath-only", () => {
      expect(parse(Read, { filePath: "/a" }).filePath).toBe("/a")
    })
    test("accepts optional offset + limit", () => {
      const parsed = parse(Read, { filePath: "/a", offset: 10, limit: 100 })
      expect(parsed.offset).toBe(10)
      expect(parsed.limit).toBe(100)
    })
  })

  describe("skill", () => {
    test("accepts name", () => {
      expect(parse(Skill, { name: "foo" }).name).toBe("foo")
    })
    test("rejects missing name", () => {
      expect(accepts(Skill, {})).toBe(false)
    })
  })

  describe("task", () => {
    test("accepts description + prompt + subagent_type", () => {
      const parsed = parse(Task, { description: "d", prompt: "p", subagent_type: "general" })
      expect(parsed.subagent_type).toBe("general")
    })
    test("accepts optional background flag", () => {
      const parsed = parse(Task, { description: "d", prompt: "p", subagent_type: "general", background: true })
      expect(parsed.background).toBe(true)
    })
    test("rejects missing prompt", () => {
      expect(accepts(Task, { description: "d", subagent_type: "general" })).toBe(false)
    })
  })

  describe("todo", () => {
    test("accepts todos array", () => {
      const parsed = parse(Todo, {
        todos: [{ id: "t1", content: "do x", status: "pending", priority: "medium" }],
      })
      expect(parsed.todos.length).toBe(1)
    })
    test("rejects missing todos", () => {
      expect(accepts(Todo, {})).toBe(false)
    })
    // Every shape the tool description, the task guidance and the design instructions tell the model
    // to send. v0.34.0 refused three of them with "Missing key": an update that left an unchanged status
    // out ("only their id, revision and the changed fields"), a scopeChange without the messageID the
    // description says may be unknown, and evidence without an explanation, which the store answers
    // with the exact update to resend but the schema never let through.
    const documented: Record<string, unknown> = {
      create: {
        todos: [
          {
            content: "Add retries",
            status: "pending",
            priority: "high",
            requirement: "adicione retries",
            criterion: "the retry suite passes",
          },
        ],
      },
      "create without status": { todos: [{ content: "Add retries", priority: "high" }] },
      "update status": { todos: [{ id: "todo_1", revision: 2, status: "in_progress" }] },
      "update a changed field only": { todos: [{ id: "todo_1", revision: 2, reason: "waiting on CI" }] },
      "update the criterion only": { todos: [{ id: "todo_1", revision: 2, criterion: "tests pass" }] },
      complete: {
        todos: [
          {
            id: "todo_1",
            revision: 2,
            status: "completed",
            evidence: { callID: "call_1", messageID: "msg_1", explanation: "the suite passed" },
          },
        ],
      },
      "complete without evidence": { todos: [{ id: "todo_1", revision: 2, status: "completed" }] },
      "complete with evidence lacking an explanation": {
        todos: [{ id: "todo_1", revision: 2, status: "completed", evidence: { callID: "call_1" } }],
      },
      "complete with only an explanation": {
        todos: [{ id: "todo_1", revision: 2, status: "completed", evidence: { explanation: "bun test passed" } }],
      },
      block: { todos: [{ id: "todo_1", revision: 2, status: "blocked", reason: "the API key is missing" }] },
      cancel: {
        todos: [
          {
            id: "todo_1",
            revision: 2,
            status: "cancelled",
            reason: "the user dropped it",
            scopeChange: { messageID: "msg_1", quote: "skip the retries" },
          },
        ],
      },
      "cancel with a scopeChange quote only": {
        todos: [
          { id: "todo_1", revision: 2, status: "cancelled", reason: "dropped", scopeChange: { quote: "skip it" } },
        ],
      },
      "cancel with a scopeChange messageID only": {
        todos: [
          { id: "todo_1", revision: 2, status: "cancelled", reason: "dropped", scopeChange: { messageID: "msg_1" } },
        ],
      },
      "read the list": { todos: [] },
      "design agent update": { todos: [{ id: "todo_1", revision: 3, status: "in_progress", criterion: "renders" }] },
    }
    for (const [name, input] of Object.entries(documented))
      test(`accepts the documented shape: ${name}`, () => {
        const result = Schema.decodeUnknownResult(TodoModel)(input)
        expect(Result.isSuccess(result) ? "accepted" : String(result.failure.message)).toBe("accepted")
      })
    test("requires nothing of an item on the wire, so a partial update is never a schema error", () => {
      const schema = toJsonSchema(Todo) as { properties: { todos: { items: Record<string, unknown> } } }
      expect(schema.properties.todos.items.required).toBeUndefined()
      const evidence = schema.properties.todos.items.properties as Record<string, Record<string, unknown>>
      expect(evidence.evidence.required).toBeUndefined()
      expect(evidence.scopeChange.required).toBeUndefined()
    })
    test("still refuses what no shape allows and names the key on the first line", () => {
      expect(accepts(TodoModel, { todos: [{ id: "todo_1", revision: "2", status: "done" }] })).toBe(false)
      expect(accepts(TodoModel, { todos: [{ content: "", status: "pending", priority: "high" }] })).toBe(false)
      expect(accepts(TodoModel, { todos: [{ content: "x", status: "pending", priority: "urgent" }] })).toBe(false)
    })
  })

  describe("webfetch", () => {
    test("defaults omitted format to markdown", () => {
      expect(parse(WebFetch, { url: "https://example.com" })).toEqual({
        url: "https://example.com",
        format: "markdown",
      })
      expect(parse(WebFetch, { url: "https://example.com", format: undefined })).toEqual({
        url: "https://example.com",
        format: "markdown",
      })
    })
  })

  describe("websearch", () => {
    test("accepts query", () => {
      expect(parse(WebSearch, { query: "opencode" }).query).toBe("opencode")
    })
  })

  describe("write", () => {
    test("accepts content + filePath", () => {
      expect(parse(Write, { content: "hi", filePath: "/a" })).toEqual({ content: "hi", filePath: "/a" })
    })
    test("rejects missing filePath", () => {
      expect(accepts(Write, { content: "hi" })).toBe(false)
    })
  })
})
