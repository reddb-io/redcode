import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { LogFile } from "../../src/observability/log-file"
import { Logging } from "../../src/observability/logging"

async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redcode-log-"))
  return { path: dir, [Symbol.asyncDispose]: () => fs.rm(dir, { recursive: true, force: true }) }
}

async function logs(file: string) {
  const result: string[] = []
  for (let index = 4; index >= 0; index--) {
    const target = index === 0 ? file : `${file}.${index}`
    if (await Bun.file(target).exists()) result.push(await Bun.file(target).text())
  }
  return result
}

describe("bounded diagnostic logs", () => {
  test("rotates during a batch and retains only the five newest bounded files", async () => {
    await using tmp = await directory()
    const file = path.join(tmp.path, "redcode.log")
    expect(await LogFile.append(file, Array.from({ length: 12 }, (_, index) => `${index}:` + "x".repeat(70)), 100)).toBe(true)
    const files = await logs(file)
    expect(files).toHaveLength(5)
    expect(files.map((value) => value.split(":")[0])).toEqual(["7", "8", "9", "10", "11"])
    expect(files.every((value) => Buffer.byteLength(value) <= 100)).toBe(true)
    expect(await Bun.file(`${file}.5`).exists()).toBe(false)
  })

  test("caps a pre-upgrade oversized file and resumes rotation after restart", async () => {
    await using tmp = await directory()
    const file = path.join(tmp.path, "redcode.log")
    await fs.writeFile(file, "old entry\n".repeat(30))
    expect(await LogFile.append(file, ["new entry"], 100)).toBe(true)
    expect(await LogFile.append(file, ["next process " + "x".repeat(70)], 100)).toBe(true)
    const files = await logs(file)
    expect(files.every((value) => Buffer.byteLength(value) <= 100)).toBe(true)
    expect(files.join("")).toContain("new entry\n")
    expect(files.at(-1)).toContain("next process")
  })

  test("bounds a huge UTF-8 record without splitting a code point", async () => {
    await using tmp = await directory()
    const file = path.join(tmp.path, "redcode.log")
    expect(await LogFile.append(file, ["😀á".repeat(100)], 100)).toBe(true)
    const bytes = await fs.readFile(file)
    expect(bytes.byteLength).toBeLessThanOrEqual(100)
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toEndWith(" [truncated]\n")
  })

  test("creates private files and never writes through a symlink or hardlink", async () => {
    await using tmp = await directory()
    const file = path.join(tmp.path, "new", "redcode.log")
    expect(await LogFile.append(file, ["private"])).toBe(true)
    if (process.platform !== "win32") {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
      expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700)
      const link = path.join(tmp.path, "linked.log")
      await fs.symlink(file, link)
      expect(await LogFile.append(link, ["must not write"])).toBe(false)
      expect(await Bun.file(file).text()).toBe("private\n")
      const hardlink = path.join(tmp.path, "hardlinked.log")
      await fs.link(file, hardlink)
      expect(await LogFile.append(hardlink, ["must not write"])).toBe(false)
      expect(await Bun.file(file).text()).toBe("private\n")
    }
  })

  test("independent processes serialize rotation without losing retained records", async () => {
    await using tmp = await directory()
    const file = path.join(tmp.path, "redcode.log")
    const worker = path.join(import.meta.dir, "../fixture/log-writer.ts")
    const children = Array.from({ length: 4 }, (_, index) =>
      Bun.spawn([process.execPath, worker, file, String(index), "256", "10"], { stdout: "pipe", stderr: "pipe" }),
    )
    const results = await Promise.all(
      children.map(async (child) => [await child.exited, await new Response(child.stderr).text()]),
    )
    expect(results).toEqual(Array.from({ length: 4 }, () => [0, ""]))
    const files = await logs(file)
    expect(files.length).toBeGreaterThan(1)
    expect(files.every((value) => Buffer.byteLength(value) <= 256)).toBe(true)
    const lines = files.join("").trim().split("\n")
    expect(lines).toHaveLength(40)
    expect(new Set(lines).size).toBe(40)
    expect(lines.every((value) => /^writer=[0-3] entry=[0-9]$/.test(value))).toBe(true)
  }, 15_000)

  test("fatal capture is durable before returning and redacts credentials", async () => {
    await using tmp = await directory()
    const file = path.join(tmp.path, "redcode.log")
    expect(await Logging.fatal(new Error("request failed: Bearer testsecret api_key=example-secret"), file)).toBe(true)
    const output = await Bun.file(file).text()
    expect(output).toContain("event=process.fatal")
    expect(output).toContain("request failed")
    expect(output).not.toContain("testsecret")
    expect(output).not.toContain("example-secret")
  })

  test("a failed write is nonfatal and warns only once for that file", async () => {
    await using tmp = await directory()
    const blocked = path.join(tmp.path, "not-a-directory")
    await fs.writeFile(blocked, "preserve")
    const module = path.resolve(import.meta.dir, "../../src/observability/log-file.ts")
    const program = [
      `import { LogFile } from ${JSON.stringify(module)}`,
      `const file = ${JSON.stringify(path.join(blocked, "redcode.log"))}`,
      'if (await LogFile.append(file, ["one"])) process.exit(1)',
      'if (await LogFile.append(file, ["two"])) process.exit(1)',
    ].join("; ")
    const child = Bun.spawn([process.execPath, "-e", program], { stdout: "pipe", stderr: "pipe" })
    const stderr = await new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    expect(stderr.match(/cannot write diagnostic log/g)).toHaveLength(1)
    expect(await Bun.file(blocked).text()).toBe("preserve")
  })

  test("fatal free-form strings redact quoted JSON credentials and entire cookie headers", async () => {
    await using tmp = await directory()
    const file = path.join(tmp.path, "redcode.log")
    await Logging.fatal(
      new Error('{"api_key":"json-secret","token":"json-token"}\nCookie: sid=first-secret; other=second-secret'),
      file,
    )
    const content = await Bun.file(file).text()
    for (const secret of ["json-secret", "json-token", "first-secret", "second-secret"]) {
      expect(content).not.toContain(secret)
    }
    expect(content).toContain("event=process.fatal")
  })
})
