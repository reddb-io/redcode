// `redcode run` works in one directory: the one the process was started in, or `--dir`. The
// instance the command boots and the directory the session is created in must be the same
// path, or the server loads a second instance for the session and the turn's tools run there.
// A spawner that sets `cwd` but leaves another shell's `PWD` in the environment (CI runners,
// process managers, editors) is how the two used to come apart.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Filesystem } from "@/util/filesystem"
import { resolveRunDirectory } from "../../../src/cli/cmd/run"
import { tmpdir } from "../../fixture/fixture"
import { reply } from "../../lib/llm-server"
import { cliIt } from "../../lib/cli-process"
import type { RunResult } from "../../lib/cli-process"

const MARKER = "run-directory-marker.txt"

// Every `instance.boot` phase in the boot trace with the directory it booted.
function booted(result: RunResult) {
  return result.stderr
    .split(/\r?\n/)
    .filter((line) => /^boot(\[server\])?\s+\d+ms\s+\+\d+ms\s+instance\.boot(\s|$)/.test(line))
    .map((line) => {
      const fact = line.match(/ directory=(".*"|\S+)/)?.[1]
      if (!fact) return undefined
      return fact.startsWith('"') ? (JSON.parse(fact) as string) : fact
    })
}

// A directory that is not the test home, so a stray `PWD` has somewhere else to point.
const elsewhere = Effect.acquireRelease(
  Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "redcode-run-pwd-"))),
  (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })).pipe(Effect.ignore),
)

const exists = (file: string) => Effect.promise(() => Bun.file(file).exists())

describe("redcode run directory", () => {
  test("resolves the working directory and a relative --dir to the same real path", async () => {
    await using tmp = await tmpdir()
    const real = Filesystem.resolve(tmp.path)
    await fs.mkdir(path.join(tmp.path, "nested"))
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    try {
      await fs.symlink(tmp.path, link, process.platform === "win32" ? "junction" : "dir")
      // A symlinked working directory names the same place as the real one.
      expect(resolveRunDirectory(undefined, link)).toBe(real)
      expect(resolveRunDirectory(undefined, tmp.path)).toBe(real)
      // `--dir` is relative to the working directory, absolute paths stand on their own.
      expect(resolveRunDirectory("nested", link)).toBe(path.join(real, "nested"))
      expect(resolveRunDirectory(path.join(link, "nested"), os.tmpdir())).toBe(path.join(real, "nested"))
    } finally {
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  cliIt.live(
    "boots one instance in the working directory when PWD names another directory",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const other = yield* elsewhere
        yield* llm.push(
          reply().tool("bash", { command: `echo marker > ${MARKER}`, description: "Write a marker in the cwd" }),
        )
        yield* llm.text("done")

        // A titled session makes no title request, so every provider call is the turn's.
        const result = yield* opencode.run("write the marker", {
          env: { PWD: other },
          extraArgs: ["--verbose", "--dangerously-skip-permissions", "--title", "Directory trace"],
        })
        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("done\n")

        expect(booted(result)).toEqual([Filesystem.resolve(home)])
        expect(yield* exists(path.join(home, MARKER))).toBe(true)
        expect(yield* exists(path.join(other, MARKER))).toBe(false)
      }),
    60_000,
  )

  cliIt.live(
    "resolves a relative --dir from the working directory, not from PWD, and boots one instance there",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const other = yield* elsewhere
        yield* llm.push(
          reply().tool("bash", { command: `echo marker > ${MARKER}`, description: "Write a marker in the cwd" }),
        )
        yield* llm.text("done")

        const result = yield* opencode.run("write the marker", {
          cwd: path.dirname(home),
          env: { PWD: other },
          extraArgs: [
            "--verbose",
            "--dangerously-skip-permissions",
            "--title",
            "Directory trace",
            "--dir",
            path.basename(home),
          ],
        })
        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("done\n")

        expect(booted(result)).toEqual([Filesystem.resolve(home)])
        expect(yield* exists(path.join(home, MARKER))).toBe(true)
        expect(yield* exists(path.join(other, MARKER))).toBe(false)
        expect(yield* exists(path.join(path.dirname(home), MARKER))).toBe(false)
      }),
    60_000,
  )
})
