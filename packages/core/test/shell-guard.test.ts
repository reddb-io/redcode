import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { ShellGuard } from "@opencode/core/shell/guard"

const root = path.join(os.tmpdir(), "guard-repository")
const input = { cwd: root, roots: [root] }
const refusal = (command: string, cwd = root) => ShellGuard.refusal(command, { ...input, cwd })

describe("ShellGuard", () => {
  test.each([
    ["git stash", "git stash"],
    ["git stash pop", "git stash"],
    ["git reset --hard HEAD~1", "git reset"],
    ["git checkout -- .", "git checkout"],
    ["git clean -fd", "git clean"],
    ["git restore src/index.ts", "git restore"],
    ["git -C ../other update-ref -d refs/heads/main", "git update-ref"],
    ["/usr/bin/git stash", "git stash"],
    ["git.exe stash", "git stash"],
    ["g'i't \"stash\"", "git stash"],
    ["sudo git reset --hard", "git reset"],
    ["GIT_DIR=/tmp/x git status", "Git directory or index overrides"],
    ["git --git-dir=/tmp/x status", "Git directory overrides"],
    ["git -c alias.x=stash x", "inline Git aliases"],
    ["git push --force origin main", "forced or deleting git push"],
    ["git push -f", "forced or deleting git push"],
    ["git push --force-with-lease", "forced or deleting git push"],
    ["git push origin +main", "forced or deleting git push"],
    ["git push origin :feature", "forced or deleting git push"],
    ["git push --delete origin feature", "forced or deleting git push"],
    ["git branch -D feature", "branch deletion or forced replacement"],
    ["git branch --delete feature", "branch deletion or forced replacement"],
    ["git switch --discard-changes main", "discarding git switch"],
    ["git worktree remove ../tree", "destructive git worktree operation"],
    ["git reflog expire --all", "git reflog expire"],
    ["bash -c 'git status && git stash'", "git stash"],
  ])("refuses %s", (command, reason) => {
    expect(refusal(command)).toBe(reason)
  })

  test.each([
    "git status",
    "git diff HEAD",
    "git log --oneline",
    "git push",
    "git push -u origin feature",
    "git commit -m 'git stash is refused'",
    "git switch -c feature",
    "git branch feature",
    "git worktree add -b feature ../feature HEAD",
    "echo git stash",
    "grep -rn 'git reset --hard' .",
    "bash script.sh",
  ])("allows %s", (command) => {
    expect(refusal(command)).toBeUndefined()
  })

  test.each([
    "rm -rf .",
    "rm -rf ./",
    "rm -fr *",
    `rm -r ${root}`,
    "rm -rf ..",
    "rm -rf /",
    "rm --recursive --force .",
    "sudo rm -rf .",
  ])("refuses recursive deletion of the repository: %s", (command) => {
    expect(refusal(command)).toBe("recursive deletion of the repository or one of its parents")
  })

  test.each(["rm -rf build", "rm -rf ./node_modules", "rm . ", "rm -rf $TARGET", "rm -f *"])(
    "allows other deletions: %s",
    (command) => {
      expect(refusal(command)).toBeUndefined()
    },
  )

  test("refuses deleting the repository from a subdirectory", () => {
    expect(refusal("rm -rf ..", path.join(root, "src"))).toBe(
      "recursive deletion of the repository or one of its parents",
    )
    expect(refusal("rm -rf *", path.join(root, "src"))).toBeUndefined()
  })

  test("splits words like the shell", () => {
    expect(ShellGuard.words(`git commit -m "a \\"quoted\\" word" 'single $x' plain\\ space`)).toEqual([
      "git",
      "commit",
      "-m",
      'a "quoted" word',
      "single $x",
      "plain space",
    ])
  })

  test("explains the refusal and how the user can allow it", () => {
    const text = ShellGuard.message("git stash", "git stash pop")
    expect(text).toContain("No command was executed")
    expect(text).toContain('"resource": "git stash *"')
  })
})

describe("ShellGuard.lifted", () => {
  test("--yolo in the Session environment lifts the guard", () => {
    expect(ShellGuard.lifted({ REDCODE_YOLO: "1" }, {})).toBe(true)
  })

  test("--auto alone never lifts the guard", () => {
    expect(ShellGuard.lifted({ PATH: "/usr/bin" }, {})).toBe(false)
    expect(ShellGuard.lifted({ REDCODE_YOLO: "0" }, {})).toBe(false)
    expect(ShellGuard.lifted({ REDCODE_YOLO: "" }, {})).toBe(false)
  })

  test("a Session environment replaces the server's, as it does for worktree placement", () => {
    expect(ShellGuard.lifted({}, { REDCODE_YOLO: "1" })).toBe(false)
    expect(ShellGuard.lifted(undefined, { REDCODE_YOLO: "1" })).toBe(true)
    expect(ShellGuard.lifted(undefined, {})).toBe(false)
  })
})
