import { describe, expect, test } from "bun:test"
import { text } from "node:stream/consumers"
import { LSPLaunch } from "@/lsp/launch"

describe("LSP NODE_OPTIONS recovery", () => {
  test("preserves quoted values and only removes complete rejected options", () => {
    const rejected = new Set(["--user-system-ca"])
    expect(LSPLaunch.nodeOptionsWithoutRejected(undefined, rejected)).toBeUndefined()
    expect(
      LSPLaunch.nodeOptionsWithoutRejected('--title="a b" "--user-system-ca" --max-old-space-size=256', rejected),
    ).toBe('--title="a b"  --max-old-space-size=256')
    expect(LSPLaunch.nodeOptionsWithoutRejected('--title="--user-system-ca"', rejected)).toBe(
      '--title="--user-system-ca"',
    )
    expect(LSPLaunch.nodeOptionsWithoutRejected("--user-system-ca=true --trace-warnings", rejected)).toBe(
      "--trace-warnings",
    )
  })

  test("real Node retries without the rejected option and keeps the caller environment intact", async () => {
    const env = { NODE_OPTIONS: '"--user-system-ca" --title="LSP test" --max-old-space-size=256' }
    const result = await LSPLaunch.recover(async () => {
      const proc = LSPLaunch.spawn(
        Bun.which("node")!,
        ["-p", "JSON.stringify({ title: process.title, options: process.env.NODE_OPTIONS })"],
        { env },
      )
      const output = await Promise.all([proc.exited, text(proc.stdout), text(proc.stderr)])
      if (output[0] !== 0) throw new Error(output[2])
      return JSON.parse(output[1])
    })
    expect(result.title).toBe("LSP test")
    expect(result.options).toContain("--max-old-space-size=256")
    expect(result.options).not.toContain("--user-system-ca")
    expect(env.NODE_OPTIONS).toContain("--user-system-ca")
    expect(LSPLaunch.nodeOptionsWithoutRejected(env.NODE_OPTIONS)).toBe(env.NODE_OPTIONS)
  })

  test("stops retrying a repeated refusal and does not retry unrelated failures", async () => {
    const calls: number[] = []
    await expect(
      LSPLaunch.recover(async () => {
        calls.push(1)
        throw new Error("node: --user-system-ca is not allowed in NODE_OPTIONS")
      }),
    ).rejects.toThrow("NODE_OPTIONS")
    expect(calls).toHaveLength(2)
    await expect(
      LSPLaunch.recover(async () => {
        throw new Error("spawn ENOENT")
      }),
    ).rejects.toThrow("ENOENT")
  })
})
