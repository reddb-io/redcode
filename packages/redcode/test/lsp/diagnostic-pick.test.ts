import { describe, expect, test } from "bun:test"
import { LSP } from "@/lsp/lsp"
import type * as LSPClient from "@/lsp/client"

const issue = (message: string): LSPClient.Diagnostic =>
  ({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    severity: 1,
    message,
  }) as LSPClient.Diagnostic

describe("Diagnostic.pick", () => {
  test("keeps only the files asked for", () => {
    const all = {
      "/repo/a.ts": [issue("a")],
      "/repo/b.ts": [issue("b")],
      "/repo/c.ts": [issue("c")],
    }
    expect(LSP.Diagnostic.pick(all, ["/repo/a.ts", "/repo/c.ts"])).toEqual({
      "/repo/a.ts": [issue("a")],
      "/repo/c.ts": [issue("c")],
    })
  })

  test("skips files with no diagnostics rather than emitting empty entries", () => {
    const all = { "/repo/a.ts": [issue("a")] }
    expect(LSP.Diagnostic.pick(all, ["/repo/missing.ts"])).toEqual({})
  })

  test("does not carry the whole workspace along", () => {
    const all: Record<string, LSPClient.Diagnostic[]> = {}
    for (let i = 0; i < 5000; i++) all[`/repo/file${i}.ts`] = [issue(`issue ${i}`)]
    const picked = LSP.Diagnostic.pick(all, ["/repo/file42.ts"])
    expect(Object.keys(picked)).toEqual(["/repo/file42.ts"])
  })
})
