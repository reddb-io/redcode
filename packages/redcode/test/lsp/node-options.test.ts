import { describe, expect, test } from "bun:test"
import { noteRejectedNodeOption, nodeOptionsWithoutRejected, spawn } from "@/lsp/launch"

// The flag Node names in its refusal is the only one that gets dropped; the rest of the user's
// NODE_OPTIONS is theirs and stays.
describe("LSP NODE_OPTIONS recovery", () => {
  test("keeps NODE_OPTIONS untouched until a server refuses a flag", () => {
    expect(nodeOptionsWithoutRejected("--max-old-space-size=8192")).toBe("--max-old-space-size=8192")
    expect(nodeOptionsWithoutRejected(undefined)).toBeUndefined()
  })

  test("learns the flag from the failure and drops only that one", () => {
    const error = new Error("LSP process exited with code 9 during initialization: node: --use-system-ca is not allowed in NODE_OPTIONS")
    expect(noteRejectedNodeOption(error)).toBe(true)
    expect(nodeOptionsWithoutRejected("--use-system-ca --max-old-space-size=8192")).toBe("--max-old-space-size=8192")
  })

  test("does not ask for another attempt once the flag is already known", () => {
    expect(noteRejectedNodeOption("node: --use-system-ca is not allowed in NODE_OPTIONS")).toBe(false)
  })

  test("the child really is spawned without the refused flag", async () => {
    // The flag was learned by the test above; this proves it reaches the child that way.
    const previous = process.env["NODE_OPTIONS"]
    process.env["NODE_OPTIONS"] = "--use-system-ca --max-old-space-size=4096"
    try {
      const proc = spawn(process.execPath, ["-e", "console.log(process.env.NODE_OPTIONS ?? '')"])
      const seen = await new Response(proc.stdout as unknown as ReadableStream).text()
      expect(seen.trim()).toBe("--max-old-space-size=4096")
    } finally {
      if (previous === undefined) delete process.env["NODE_OPTIONS"]
      else process.env["NODE_OPTIONS"] = previous
    }
  })

  test("ignores failures that are about something else", () => {
    expect(noteRejectedNodeOption(new Error("spawn ENOENT"))).toBe(false)
    expect(noteRejectedNodeOption(undefined)).toBe(false)
  })
})
