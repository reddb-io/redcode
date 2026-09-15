import { afterEach, describe, expect, test } from "bun:test"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { PermissionV1 } from "@reddb-io/redcode-core/v1/permission"
import { JsonSchemaValidate } from "@reddb-io/redcode-core/util/json-schema-validate"
import { SessionTaskFacts } from "@reddb-io/redcode-core/session/task-facts"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { CodeModeTool, describeCatalog } from "@/tool/code-mode"
import { CodeModeGate } from "@/tool/code-mode-gate"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"
import { Plugin } from "@/plugin"
import { Session } from "@/session/session"
import { HumanWait } from "@/session/human-wait"
import { Tool } from "@/tool/tool"
import { ToolOutputBridge } from "@/tool/output-bridge"
import { MessageID, SessionID } from "@/session/schema"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_code-mode-policy"),
  messageID: MessageID.make("msg_code-mode-policy"),
  agent: "build",
  abort: new AbortController().signal,
  callID: "call_policy",
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const text = (value: string) => ({ content: [{ type: "text", text: value }] })

function mcpTool(
  name: string,
  handler: (args: Record<string, unknown>) => unknown,
  inputSchema: Record<string, unknown> = { type: "object", properties: {} },
): MCP.McpTool {
  return {
    def: { name, description: name, inputSchema } as MCPToolDef,
    client: {
      callTool: async (params: { arguments?: Record<string, unknown> }) => handler(params.arguments ?? {}),
    } as unknown as MCP.McpTool["client"],
  }
}

function build(
  mcpTools: Record<string, MCP.McpTool>,
  options: { codeMode?: CodeModeGate.Config; bound?: ToolOutputBridge.Interface["bound"] } = {},
) {
  const servers = [...new Set(Object.keys(mcpTools).map((key) => key.split("_")[0]!))]
  const layer = Layer.mergeAll(
    Layer.mock(Config.Service, {
      get: () => Effect.succeed({ experimental: { code_mode: options.codeMode } } as any),
    }),
    Layer.mock(Plugin.Service, {
      trigger: ((_name, _input, output) => Effect.succeed(output)) as Plugin.Interface["trigger"],
    }),
    Layer.mock(ToolOutputBridge.Service, {
      bound: options.bound ?? ((content: string) => Effect.succeed({ content, truncated: false as const })),
    }),
    Layer.mock(Agent.Service, { get: () => Effect.succeed({ name: "build", permission: [] } as any) }),
    Layer.mock(Session.Service, { get: () => Effect.succeed({ permission: [] } as any) }),
    Layer.mock(MCP.Service, {
      tools: () => Effect.succeed(mcpTools),
      clients: () => Effect.succeed(Object.fromEntries(servers.map((name) => [name, {} as any]))),
    }),
  )
  return Effect.runPromise(CodeModeTool.pipe(Effect.flatMap(Tool.init), Effect.provide(layer)))
}

async function failure(effect: Effect.Effect<unknown>) {
  const exit = await Effect.runPromise(effect.pipe(Effect.exit))
  if (Exit.isSuccess(exit)) throw new Error("expected the tool to fail")
  return Cause.squash(exit.cause) as Error
}

const issueSchema = {
  type: "object",
  properties: { owner: { type: "string" }, state: { type: "string", enum: ["open", "closed"] } },
  required: ["owner"],
  additionalProperties: false,
}

afterEach(() => HumanWait.forget(ctx.sessionID, ctx.callID!))

describe("code mode input validation", () => {
  test("a nested call with invalid input fails as a catchable error naming the path, before the server", async () => {
    const called: unknown[] = []
    const tool = await build({
      gh_issue_read: mcpTool("issue_read", (args) => (called.push(args), text("ok")), issueSchema),
    })
    const out = await Effect.runPromise(
      tool.execute(
        { code: "try { await tools.gh.issue_read({ state: 'pending', extra: 1 }) } catch (e) { return e.message }" },
        ctx,
      ),
    )
    expect(out.output).toContain("Invalid input for tools.gh.issue_read: ")
    expect(out.output).toContain("input.owner is required")
    expect(out.output).toContain('input.state must be one of "open", "closed"')
    expect(out.output).toContain("input.extra is not an accepted property")
    expect(called).toEqual([])
    expect(out.metadata.toolCalls).toEqual([
      { tool: "gh.issue_read", status: "error", input: { state: "pending", extra: 1 } },
    ])
  })

  test("server regular expressions are never run, and oversized schemas are not compiled", () => {
    // A catastrophic pattern: with it compiled, this input would hang the event loop.
    const evil = { type: "object", properties: { name: { type: "string", pattern: "^(a+)+$" } }, required: ["name"] }
    const started = Date.now()
    expect(JsonSchemaValidate.problems(evil, { name: "a".repeat(40) + "!" })).toEqual([])
    expect(Date.now() - started).toBeLessThan(1000)
    expect(JsonSchemaValidate.problems(evil, {})).toEqual([{ path: "input.name", message: "is required" }])
    // A property literally named "pattern" keeps its schema.
    expect(
      JsonSchemaValidate.problems(
        { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
        { pattern: 1 },
      ),
    ).toEqual([{ path: "input.pattern", message: "must be string" }])
    // patternProperties plus a closed object fails open instead of refusing matching keys.
    expect(
      JsonSchemaValidate.problems(
        { type: "object", patternProperties: { "^x-": { type: "string" } }, additionalProperties: false },
        { "x-trace": "1" },
      ),
    ).toEqual([])
    const huge = {
      type: "object",
      required: ["id"],
      properties: Object.fromEntries(
        Array.from({ length: 4000 }, (_, i) => [`field_${i}`, { type: "string", description: "d".repeat(80) }]),
      ),
    }
    expect(JSON.stringify(huge).length).toBeGreaterThan(JsonSchemaValidate.MAX_SCHEMA_BYTES)
    const before = JsonSchemaValidate.compileCount()
    expect(JsonSchemaValidate.problems(huge, {})).toEqual([])
    expect(JsonSchemaValidate.compileCount()).toBe(before)
  })

  test("the validator reports types and fails open on a schema it cannot compile", () => {
    expect(JsonSchemaValidate.problems({ type: "object", properties: { n: { type: "integer" } } }, { n: "1" })).toEqual(
      [{ path: "input.n", message: "must be integer" }],
    )
    expect(JsonSchemaValidate.problems({ type: "object", properties: { a: { $ref: "#/missing" } } }, { a: 1 })).toEqual(
      [],
    )
    expect(
      JsonSchemaValidate.problems(
        { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", required: ["x"] },
        {},
      ),
    ).toEqual([{ path: "input.x", message: "is required" }])
  })
})

describe("code mode limits", () => {
  const counter = () => {
    const seen = { count: 0 }
    return { seen, tools: { a_tool: mcpTool("tool", () => (seen.count++, text("ok"))) } }
  }

  test("a script stops at 50 tool calls by default", async () => {
    const { seen, tools } = counter()
    const tool = await build(tools)
    const error = await failure(tool.execute({ code: "for (let i = 0; i < 60; i++) await tools.a.tool({ i })" }, ctx))
    expect(error.message).toContain("tool-call limit of 50")
    expect(seen.count).toBe(50)
  })

  test("max_tool_calls is configurable", async () => {
    const { seen, tools } = counter()
    const tool = await build(tools, { codeMode: { max_tool_calls: 3 } })
    const error = await failure(tool.execute({ code: "for (let i = 0; i < 10; i++) await tools.a.tool({ i })" }, ctx))
    expect(error.message).toContain("tool-call limit of 3")
    expect(seen.count).toBe(3)
  })

  test("the third identical call in one script fails; different inputs are fine", async () => {
    const { seen, tools } = counter()
    const tool = await build(tools)
    const out = await Effect.runPromise(
      tool.execute(
        {
          code: `
            await tools.a.tool({ q: 1, r: 2 })
            await tools.a.tool({ r: 2, q: 1 })
            await tools.a.tool({ q: 3 })
            try { await tools.a.tool({ q: 1, r: 2 }) } catch (e) { return e.message }
          `,
        },
        ctx,
      ),
    )
    expect(out.output).toContain("tools.a.tool was already called 2 times with this exact input in this script")
    expect(seen.count).toBe(3)
  })

  test("while one call waits on a prompt, other running work still counts against timeout_ms", async () => {
    const tool = await build(
      { a_ask: mcpTool("ask", () => text("asked")), a_hang: mcpTool("hang", () => new Promise(() => {})) },
      { codeMode: { timeout_ms: 300 } },
    )
    const slowAsk: Tool.Context = {
      ...ctx,
      ask: (req) => (req.permission === "a_ask" ? Effect.sleep("3 seconds") : Effect.void),
    }
    const started = Date.now()
    const error = await failure(
      tool.execute({ code: "return await Promise.all([tools.a.ask({}), tools.a.hang({})])" }, slowAsk),
    )
    expect(error.message).toContain("Execution timed out after 300ms")
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test("a timeout aborts the signal of calls still in flight", async () => {
    const signals: AbortSignal[] = []
    const hang: MCP.McpTool = {
      def: { name: "hang", description: "hang", inputSchema: { type: "object", properties: {} } } as MCPToolDef,
      client: {
        callTool: (_params: unknown, _schema: unknown, options: { signal: AbortSignal }) => {
          signals.push(options.signal)
          return new Promise(() => {})
        },
      } as unknown as MCP.McpTool["client"],
    }
    const tool = await build({ a_hang: hang }, { codeMode: { timeout_ms: 200 } })
    await failure(tool.execute({ code: "return await tools.a.hang({})" }, ctx))
    expect(signals).toHaveLength(1)
    expect(signals[0]!.aborted).toBe(true)
  })

  test("timeout_ms stops a script that never finishes", async () => {
    const tool = await build(
      { a_hang: mcpTool("hang", () => new Promise(() => {})) },
      { codeMode: { timeout_ms: 200 } },
    )
    const error = await failure(tool.execute({ code: "return await tools.a.hang({})" }, ctx))
    expect(error.message).toContain("Execution timed out after 200ms")
  })

  test("time spent on a permission prompt does not count against timeout_ms", async () => {
    HumanWait.claim(ctx.sessionID, ctx.callID!)
    const tool = await build({ a_tool: mcpTool("tool", () => text("ok")) }, { codeMode: { timeout_ms: 300 } })
    const slowAsk: Tool.Context = { ...ctx, ask: () => Effect.sleep("700 millis") }
    const out = await Effect.runPromise(tool.execute({ code: "return await tools.a.tool({})" }, slowAsk))
    expect(out.output).toBe("ok")
  })

  test("the final output goes through the tool output store", async () => {
    const tool = await build(
      {},
      {
        bound: (content) =>
          Effect.succeed(
            content.length > 100
              ? { content: content.slice(0, 100), truncated: true as const, outputPath: "/managed/out-1" }
              : { content, truncated: false as const },
          ),
      },
    )
    const out = await Effect.runPromise(tool.execute({ code: "return 'x'.repeat(5000)" }, ctx))
    expect(out.output).toHaveLength(100)
    expect(out.metadata.truncated).toBe(true)
    expect(out.metadata.outputPath).toBe("/managed/out-1")
  })

  test("max_output_bytes cuts the script result before the store sees it", async () => {
    const tool = await build({}, { codeMode: { max_output_bytes: 50 } })
    const out = await Effect.runPromise(tool.execute({ code: "return 'y'.repeat(500)" }, ctx))
    expect(out.output).toContain("[result truncated: ")
    expect(out.output.length).toBeLessThan(300)
  })

  test("attachments use the direct MCP path's MIME allowlist and size cap", async () => {
    const huge = "A".repeat(Math.ceil(((10 * 1024 * 1024 + 10) * 4) / 3))
    const tool = await build({
      media_get: mcpTool("get", () => ({
        content: [
          { type: "image", data: PNG, mimeType: "image/png" },
          { type: "image", data: "PHN2Zz4=", mimeType: "image/svg+xml" },
          { type: "resource", resource: { uri: "file:///big.pdf", mimeType: "application/pdf", blob: huge } },
          { type: "resource", resource: { uri: "file:///a.zip", mimeType: "application/zip", blob: "UEsDBA==" } },
        ],
      })),
    })
    const out = await Effect.runPromise(tool.execute({ code: "return await tools.media.get({})" }, ctx))
    expect(out.attachments).toEqual([{ type: "file", mime: "image/png", url: `data:image/png;base64,${PNG}` }])
    expect(out.output).toContain("(image/svg+xml, 5 B) is not a supported attachment type")
    expect(out.output).toContain("file:///big.pdf (application/pdf, 11 MB) exceeds 10 MB")
    expect(out.output).toContain("file:///a.zip (application/zip, 4 B) is not a supported attachment type")
  })
})

describe("code mode permission UX", () => {
  test("an ask from a script names the script path and a bounded args preview", async () => {
    const asked: any[] = []
    const tool = await build({ gh_issue_read: mcpTool("issue_read", () => text("ok")) })
    await Effect.runPromise(
      tool.execute(
        { code: "return await tools.gh.issue_read({ owner: 'reddb-io', body: 'z'.repeat(1000) })" },
        { ...ctx, ask: (req) => Effect.sync(() => void asked.push(req)) },
      ),
    )
    expect(asked).toHaveLength(1)
    expect(asked[0].permission).toBe("gh_issue_read")
    expect(asked[0].metadata.script.tool).toBe("gh.issue_read")
    expect(asked[0].metadata.script.args.startsWith('{"owner":"reddb-io","body":"zzz')).toBe(true)
    expect(asked[0].metadata.script.args.length).toBeLessThanOrEqual(300)
  })

  test("parallel asks for the same tool are queued one at a time; other tools are not held back", async () => {
    const open = new Map<string, number>()
    const peak = new Map<string, number>()
    let overall = 0
    let overallPeak = 0
    const ask: Tool.Context["ask"] = (req) =>
      Effect.gen(function* () {
        open.set(req.permission, (open.get(req.permission) ?? 0) + 1)
        overall++
        peak.set(req.permission, Math.max(peak.get(req.permission) ?? 0, open.get(req.permission)!))
        overallPeak = Math.max(overallPeak, overall)
        yield* Effect.sleep("30 millis")
        open.set(req.permission, open.get(req.permission)! - 1)
        overall--
      })
    const tool = await build({ a_one: mcpTool("one", () => text("1")), a_two: mcpTool("two", () => text("2")) })
    const out = await Effect.runPromise(
      tool.execute(
        {
          code: "const r = await Promise.all([tools.a.one({ n: 1 }), tools.a.one({ n: 2 }), tools.a.one({ n: 3 }), tools.a.two({})]); return r.join('')",
        },
        { ...ctx, ask },
      ),
    )
    expect(out.output).toBe("1112")
    expect(peak.get("a_one")).toBe(1)
    expect(overallPeak).toBe(2)
  })

  test("a rejection returns completed results and the rejection instead of discarding them", async () => {
    const called: string[] = []
    const tool = await build({
      a_first: mcpTool("first", () => (called.push("first"), { content: [], structuredContent: { id: 7 } })),
      a_second: mcpTool("second", () => (called.push("second"), text("never"))),
    })
    const reject: Tool.Context["ask"] = (req) =>
      req.permission === "a_second" ? Effect.die(new PermissionV1.RejectedError()) : Effect.void
    const out = await Effect.runPromise(
      tool.execute(
        {
          code: "const first = await tools.a.first({}); const second = await tools.a.second({}); return { first, second }",
        },
        { ...ctx, ask: reject },
      ),
    )
    expect(called).toEqual(["first"])
    expect(out.metadata.rejected).toBe(true)
    expect(out.metadata.error).toBeUndefined()
    expect(out.output).toContain(
      "Rejected: tools.a.second: The user rejected permission to use this specific tool call.",
    )
    expect(out.output).toContain('Completed calls before the rejection:\n- tools.a.first: {"id":7}')
  })

  test("after one rejection, asks still queued in the script are refused without prompting", async () => {
    const called: string[] = []
    let prompts = 0
    const tool = await build({ a_one: mcpTool("one", (args) => (called.push(String(args.n)), text("1"))) })
    const reject: Tool.Context["ask"] = () =>
      Effect.gen(function* () {
        prompts++
        yield* Effect.sleep("30 millis")
        return yield* Effect.die(new PermissionV1.RejectedError())
      })
    const out = await Effect.runPromise(
      tool.execute(
        { code: "return await Promise.all([tools.a.one({ n: 1 }), tools.a.one({ n: 2 }), tools.a.one({ n: 3 })])" },
        { ...ctx, ask: reject },
      ),
    )
    expect(prompts).toBe(1)
    expect(called).toEqual([])
    expect(out.metadata.rejected).toBe(true)
  })
})

describe("code mode per-call policy and native tools", () => {
  const readTool: Tool.NativeTool = {
    id: "read",
    description: "Read a file",
    parameters: Schema.Struct({ filePath: Schema.String }),
    execute: (args: any) => Effect.succeed({ title: "notes.txt", output: `body of ${args.filePath}`, metadata: {} }),
  }

  function nestedCtx(
    decide: (request: Tool.NestedCall<unknown>) => "run" | Error | Record<string, unknown>,
    userTools?: Record<string, boolean>,
  ) {
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = []
    let n = 0
    const nested: Tool.Nested = {
      natives: [readTool],
      userTools,
      call: (request) =>
        Effect.suspend(() => {
          requests.push({ tool: request.tool, args: request.args })
          const decision = decide(request as Tool.NestedCall<unknown>)
          if (decision instanceof Error) return Effect.fail(decision)
          n++
          // A record stands for a PreExecute hook rewriting the arguments.
          const args = decision === "run" ? request.args : decision
          return request.run({ args, ctx: { ...ctx, callID: `${ctx.callID}/${n}` } })
        }),
    }
    return { requests, ctx: { ...ctx, nested } satisfies Tool.Context }
  }

  test("a tool the prompt switched off is not in the script and cannot be called", async () => {
    const called: string[] = []
    const tool = await build({
      github_issue_read: mcpTool("issue_read", () => text("issue")),
      github_issue_write: mcpTool("issue_write", () => (called.push("write"), text("written"))),
    })
    const { ctx: policyCtx } = nestedCtx(() => "run", { github_issue_write: false })
    const keys = await Effect.runPromise(tool.execute({ code: "return Object.keys(tools.github)" }, policyCtx))
    expect(JSON.parse(keys.output)).toEqual(["issue_read"])
    const error = await failure(tool.execute({ code: "return await tools.github.issue_write({})" }, policyCtx))
    expect(error.message).toContain("Unknown tool 'github.issue_write'")
    expect(called).toEqual([])
  })

  test("script inputs are validated after PreExecute hooks rewrote them", async () => {
    const seen: unknown[] = []
    const tool = await build({
      gh_issue_read: mcpTool("issue_read", (args) => (seen.push(args), text("issue")), issueSchema),
    })
    const { ctx: policyCtx } = nestedCtx(() => ({ owner: "hook-supplied" }))
    const out = await Effect.runPromise(tool.execute({ code: "return await tools.gh.issue_read({})" }, policyCtx))
    expect(out.output).toBe("issue")
    expect(seen).toEqual([{ owner: "hook-supplied" }])
  })

  test("a native tool schema is compiled once, not per call", async () => {
    const tool = await build({})
    const { ctx: policyCtx } = nestedCtx(() => "run")
    await Effect.runPromise(tool.execute({ code: "return await tools.redcode.read({ filePath: 'a' })" }, policyCtx))
    const before = JsonSchemaValidate.compileCount()
    await Effect.runPromise(
      tool.execute(
        { code: "await tools.redcode.read({ filePath: 'b' }); return await tools.redcode.read({ filePath: 'c' })" },
        policyCtx,
      ),
    )
    expect(JsonSchemaValidate.compileCount()).toBe(before)
  })

  test("every nested MCP and native call goes through the session's per-call policy", async () => {
    const tool = await build({ gh_issue_read: mcpTool("issue_read", () => text("issue")) })
    const { requests, ctx: policyCtx } = nestedCtx(() => "run")
    const out = await Effect.runPromise(
      tool.execute(
        {
          code: "const a = await tools.gh.issue_read({ owner: 'o' }); const b = await tools.redcode.read({ filePath: 'notes.txt' }); return [a, b]",
        },
        policyCtx,
      ),
    )
    expect(JSON.parse(out.output)).toEqual(["issue", "body of notes.txt"])
    expect(requests).toEqual([
      { tool: "gh_issue_read", args: { owner: "o" } },
      { tool: "read", args: { filePath: "notes.txt" } },
    ])
    expect(out.metadata.toolCalls).toEqual([
      { tool: "gh.issue_read", status: "completed", input: { owner: "o" } },
      { tool: "redcode.read", status: "completed", input: { filePath: "notes.txt" }, title: "notes.txt" },
    ])
  })

  test("a call the policy refuses (a PreExecute hook, the loop guard) never reaches the tool", async () => {
    const called: string[] = []
    const tool = await build({ gh_delete: mcpTool("delete", () => (called.push("delete"), text("gone"))) })
    const { ctx: policyCtx } = nestedCtx((request) =>
      request.tool === "gh_delete" ? new Error("blocked by a PreExecute hook") : "run",
    )
    const out = await Effect.runPromise(
      tool.execute({ code: "try { await tools.gh.delete({}) } catch (e) { return e.message }" }, policyCtx),
    )
    expect(out.output).toBe("blocked by a PreExecute hook")
    expect(called).toEqual([])
  })

  test("native tool inputs are validated against their schema too", async () => {
    const tool = await build({})
    const { requests, ctx: policyCtx } = nestedCtx(() => "run")
    const out = await Effect.runPromise(
      tool.execute(
        { code: "try { await tools.redcode.read({ path: 'x' }) } catch (e) { return e.message }" },
        policyCtx,
      ),
    )
    expect(out.output).toContain("Invalid input for tools.redcode.read: input.filePath is required")
    // Validation runs inside the policy, after hooks could rewrite the arguments, and before the tool.
    expect(requests).toEqual([{ tool: "read", args: { path: "x" } }])
  })

  test("the catalog lists native read tools under tools.redcode", () => {
    const description = describeCatalog({}, [], { natives: [readTool] })
    expect(description).toContain("- redcode (1 tool)")
    expect(description).toContain("tools.redcode.read(input: {\n  filePath: string,\n})")
  })

  test("only read-only native tools are ever exposed to scripts", () => {
    expect([...CodeModeGate.SCRIPT_NATIVE_TOOLS].sort()).toEqual(["glob", "grep", "read", "webfetch"])
    for (const id of [
      "write",
      "edit",
      "apply_patch",
      "bash",
      "shell",
      "task",
      "question",
      "todowrite",
      "plan_exit",
      "goal_complete",
      "monitor",
      "design_edit",
    ])
      expect(CodeModeGate.SCRIPT_NATIVE_TOOLS.has(id)).toBe(false)
  })

  test("script-internal calls are not task evidence: execute is never a verification", () => {
    expect(SessionTaskFacts.kind(CodeModeGate.TOOL_ID)).toBe("other")
    expect(SessionTaskFacts.kind("read")).not.toBe("verification")
  })
})

describe("code mode errors", () => {
  test("a flat tool name suggests the dotted path", async () => {
    const tool = await build({ github_issue_read: mcpTool("issue_read", () => text("ok")) })
    const error = await failure(tool.execute({ code: "return await tools.github_issue_read({})" }, ctx))
    expect(error.message).toContain("Did you mean tools.github.issue_read?")
  })

  test("a syntax error reports line, column and a code frame", async () => {
    const tool = await build({})
    const error = await failure(tool.execute({ code: "const ok = 1\nconst broken = ;\nreturn ok" }, ctx))
    expect(error.message).toContain("(line 2, col 16)")
    expect(error.message).toContain("2 | const broken = ;")
  })
})

describe("code mode gating", () => {
  const schemas = (count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `gh_tool_${i}`,
        { def: { name: `tool_${i}`, description: "d".repeat(200), inputSchema: { type: "object" } } },
      ]),
    )

  test("off by default, on when configured or forced by the env flag", () => {
    const base = { providerID: "anthropic", modelID: "claude-x", mcpTools: schemas(200) }
    expect(CodeModeGate.enabled({ ...base, flag: false })).toBe(false)
    expect(CodeModeGate.enabled({ ...base, flag: false, config: { enabled: "on" } })).toBe(true)
    expect(CodeModeGate.enabled({ ...base, flag: true, config: { enabled: "off" } })).toBe(true)
  })

  test("auto needs an allowlisted model and MCP schemas above the threshold", () => {
    const config = { enabled: "auto" as const, models: ["anthropic/*", "gpt-5*"] }
    const big = schemas(200)
    expect(CodeModeGate.estimateTokens(big)).toBeGreaterThan(CodeModeGate.DEFAULT_THRESHOLD)
    expect(
      CodeModeGate.enabled({ flag: false, config, providerID: "anthropic", modelID: "claude-x", mcpTools: big }),
    ).toBe(true)
    expect(CodeModeGate.enabled({ flag: false, config, providerID: "openai", modelID: "gpt-5.1", mcpTools: big })).toBe(
      true,
    )
    expect(CodeModeGate.enabled({ flag: false, config, providerID: "zai", modelID: "glm-5", mcpTools: big })).toBe(
      false,
    )
    expect(
      CodeModeGate.enabled({ flag: false, config, providerID: "anthropic", modelID: "claude-x", mcpTools: schemas(2) }),
    ).toBe(false)
    expect(
      CodeModeGate.enabled({
        flag: false,
        config: { enabled: "auto" },
        providerID: "anthropic",
        modelID: "claude-x",
        mcpTools: big,
      }),
    ).toBe(false)
  })

  test("limits default to 50 calls, 120 s and 1 MB and follow config", () => {
    expect(CodeModeGate.limits()).toEqual({ maxToolCalls: 50, timeoutMs: 120_000, maxOutputBytes: 1_000_000 })
    expect(CodeModeGate.limits({ max_tool_calls: 5, timeout_ms: 10, max_output_bytes: 20 })).toEqual({
      maxToolCalls: 5,
      timeoutMs: 10,
      maxOutputBytes: 20,
    })
  })
})
