export * as ShellGuard from "./guard.js"

import os from "os"
import path from "path"

/**
 * Repository guard for the shell tool: Git operations that discard or rewrite work, and recursive
 * deletion of the working tree. It reads one parsed simple command at a time (the shell parser has
 * already split pipelines, lists and substitutions), so it matches words, never prose. It is a
 * conservative guard, not a sandbox for arbitrary scripts or interpreters.
 */
export const FORBIDDEN_GIT = [
  "reset",
  "stash",
  "clean",
  "restore",
  "checkout",
  "read-tree",
  "checkout-index",
  "update-ref",
] as const

/** Words that run the command that follows them. */
const WRAPPERS = new Set(["sudo", "doas", "env", "command", "exec", "builtin", "nice", "nohup", "time", "xargs"])
/** Shells whose `-c` script is checked like a command line of its own. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"])
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/

export type Input = {
  /** Directory the command runs in. */
  readonly cwd: string
  /** Directories whose recursive deletion is refused, with every ancestor: the Location and project roots. */
  readonly roots: readonly string[]
}

/** Why one parsed command is refused, or undefined when the guard allows it. */
export function refusal(command: string, input: Input): string | undefined {
  return check(words(command), input, 0)
}

/** The model-facing refusal: what was blocked, that nothing ran, and how the user can allow it. */
export function message(reason: string, resource: string) {
  return [
    `Repository policy prohibits ${reason}: ${resource}`,
    "No command was executed.",
    "Preserve existing work and use a non-destructive alternative (for example commit, a new branch, or `git worktree add`), or ask the user to run it.",
    "Do not retry through another spelling, alias, script or tool.",
    `The user can allow it with a permission rule such as { "action": "shell", "resource": "${allowPattern(resource)}", "effect": "allow" }.`,
  ].join(" ")
}

function allowPattern(resource: string) {
  const [first, second] = words(resource)
  if (!first) return "*"
  return second ? `${first} ${second} *` : `${first} *`
}

function check(args: readonly string[], input: Input, depth: number): string | undefined {
  const assignments = args.flatMap((word) => {
    const match = ASSIGNMENT.exec(word)
    return match ? [match[1]] : []
  })
  if (assignments.some((name) => /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE)$/i.test(name)))
    return "Git directory or index overrides"
  const head = args.findIndex((word) => !ASSIGNMENT.test(word))
  if (head === -1) return
  const name = program(args[head])
  if (SHELLS.has(name) && depth < 3) {
    const flag = args.findIndex((word, index) => index > head && /^-[a-z]*c[a-z]*$/.test(word))
    const script = flag === -1 ? undefined : args[flag + 1]
    if (script === undefined) return
    return script
      .split(/&&|\|\||[;&|\n]/)
      .map((segment) => check(words(segment), input, depth + 1))
      .find((reason) => reason !== undefined)
  }
  const start = WRAPPERS.has(name)
    ? args.findIndex((word, index) => index > head && (program(word) === "git" || program(word) === "rm"))
    : head
  if (start === -1) return
  const target = program(args[start])
  if (target === "git") return git(args.slice(start + 1))
  if (target === "rm") return remove(args.slice(start + 1), input)
}

function git(args: readonly string[]) {
  let index = 0
  while (args[index]?.startsWith("-")) {
    const option = args[index++]
    if (/^--(?:git-dir|work-tree)(?:=|$)/.test(option)) return "Git directory overrides"
    if (option === "-c" && /^alias\./i.test(args[index] ?? "")) return "inline Git aliases"
    if (option === "-C" || option === "-c") index++
  }
  const name = args[index]?.toLowerCase()
  const rest = args.slice(index + 1)
  if (name === undefined) return
  if (FORBIDDEN_GIT.some((item) => item === name)) return `git ${name}`
  if (
    name === "push" &&
    rest.some(
      (arg) =>
        /^--(?:force|mirror|delete|prune)/.test(arg) ||
        /^-[^-]*[fd]/.test(arg) ||
        arg.startsWith("+") ||
        arg.startsWith(":"),
    )
  )
    return "forced or deleting git push"
  if (name === "branch" && rest.some((arg) => /^--(?:delete|force|move)/.test(arg) || /^-[^-]*[dDfMm]/.test(arg)))
    return "branch deletion or forced replacement"
  if (
    name === "switch" &&
    rest.some((arg) => ["-f", "-C", "--force", "--discard-changes", "--force-create"].includes(arg))
  )
    return "discarding git switch"
  if (name === "worktree" && rest.some((arg) => ["remove", "prune", "--force", "-f", "-B"].includes(arg)))
    return "destructive git worktree operation"
  if (name === "reflog" && rest.includes("expire")) return "git reflog expire"
}

function remove(args: readonly string[], input: Input) {
  const end = args.indexOf("--")
  const options = (end === -1 ? args : args.slice(0, end)).filter((arg) => arg.startsWith("-"))
  if (!options.some((option) => option === "--recursive" || /^-[^-]*[rR]/.test(option))) return
  const targets = [
    ...(end === -1 ? args : args.slice(0, end)).filter((arg) => !arg.startsWith("-")),
    ...(end === -1 ? [] : args.slice(end + 1)),
  ]
  const roots = input.roots.map((root) => path.resolve(root))
  const refused = targets.some((target) => {
    if (target.includes("$") || target.includes("`")) return false
    if (target === "*" || target === "./*" || target === ".*") return roots.includes(path.resolve(input.cwd))
    const resolved = path.resolve(input.cwd, home(target))
    return roots.some((root) => within(resolved, root))
  })
  if (refused) return "recursive deletion of the repository or one of its parents"
}

function home(target: string) {
  if (target === "~") return os.homedir()
  if (target.startsWith("~/")) return path.join(os.homedir(), target.slice(2))
  return target
}

/** Whether `child` is `parent` or inside it. */
function within(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
}

/** The command a word names: its base name, without a Windows `.exe`, in lower case. */
function program(word: string) {
  return (word.split(/[\\/]/).at(-1) ?? word).replace(/\.exe$/i, "").toLowerCase()
}

/** Shell words of one simple command, with quotes and escapes removed the way the shell would. */
export function words(command: string) {
  const result: string[] = []
  let current = ""
  let started = false
  let quote: "'" | '"' | undefined
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if (quote === "'") {
      if (char === "'") quote = undefined
      else current += char
      continue
    }
    if (char === "\\") {
      const next = command[index + 1]
      index++
      if (next === "\n" || next === undefined) continue
      // Inside double quotes a backslash only escapes the characters the shell treats specially.
      if (quote === '"' && !['"', "\\", "$", "`"].includes(next)) current += char
      current += next
      started = true
      continue
    }
    if (quote === '"') {
      if (char === '"') quote = undefined
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) result.push(current)
      current = ""
      started = false
      continue
    }
    current += char
    started = true
  }
  if (started) result.push(current)
  return result
}
