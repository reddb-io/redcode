import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { tmpdir } from "../../../core/test/fixture/tmpdir"
import { gitWorktree } from "../../../core/test/fixture/git-worktree"

test("YOLO bypasses repository guards and explicit permission denials in an isolated process", async () => {
  await using tmp = await tmpdir()
  const repo = await gitWorktree(tmp.path)
  const script = `
    import { Effect } from "effect"
    import { RepositoryGuard } from "@reddb-io/redcode-core/repository-guard"
    import { Permission } from "./src/permission"
    const root = Bun.argv[1]
    const denied = [{ permission: "*", pattern: "*", action: "deny" }]
    await Effect.runPromise(RepositoryGuard.assertWrite(root + "/source.txt"))
    await Effect.runPromise(RepositoryGuard.assertShell(root, "git reset --hard"))
    if (await RepositoryGuard.prepare(root) !== root) throw new Error("YOLO created a worktree")
    if (Permission.evaluate("edit", "*", denied).action !== "allow") throw new Error("permission denied")
    if (Permission.disabled(["write", "bash", "design_exit"], denied).size) throw new Error("tools filtered")
    if (!RepositoryGuard.instructions().includes("YOLO mode is active")) throw new Error("wrong instructions")
  `
  const proc = Bun.spawn([process.execPath, "-e", script, repo.root], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...process.env, REDCODE_YOLO: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [, error, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  expect(error).toBe("")
  expect(exit).toBe(0)
  expect(await Bun.file(repo.root + "/source.txt").text()).toBe("user changes\n")
})
