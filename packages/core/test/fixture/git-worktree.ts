import path from "node:path"

export async function gitWorktree(directory: string) {
  const root = path.join(directory, "source")
  const tree = path.join(directory, "task")
  const git = async (...args: string[]) => {
    const proc = Bun.spawn(["git", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    const [, error, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (exit !== 0) throw new Error(error)
  }
  await git("init", "--quiet", root)
  await git("-C", root, "config", "core.autocrlf", "false")
  await Bun.write(path.join(root, "source.txt"), "committed\n")
  await git("-C", root, "add", "source.txt")
  await git(
    "-C",
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  )
  await git("-C", root, "worktree", "add", "-b", "task-worktree", tree)
  await Bun.write(path.join(root, "source.txt"), "user changes\n")
  await Bun.write(path.join(root, "untracked.txt"), "keep me\n")
  return { root, tree }
}
