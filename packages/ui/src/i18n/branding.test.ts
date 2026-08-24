import { expect, test } from "bun:test"
import path from "path"

test("locale copy preserves the OpenCode Go provider name", async () => {
  const violations: string[] = []

  for await (const relative of new Bun.Glob("*.ts").scan({ cwd: import.meta.dir })) {
    if (relative.endsWith(".test.ts")) continue
    const lines = (await Bun.file(path.join(import.meta.dir, relative)).text()).split("\n")

    lines.forEach((line, index) => {
      if (!/OpenCode|RedCode/.test(line)) return
      if (line.includes("OpenCode Go")) return
      violations.push(`${relative}:${index + 1}: ${line.trim()}`)
    })
  }

  expect(violations).toEqual([])
})
