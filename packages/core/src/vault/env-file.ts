export * as VaultEnvFile from "./env-file.js"

import { Effect } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { sanitize } from "@opencode/schema/vault"

/**
 * Where a project's secrets live on disk: the `.env` file at the root of its repository, which git ignores. The vault
 * hydrates from it and writes through to it, so `GITHUB_TOKEN` in the file and `{vault:github-token}` in a prompt
 * name the same secret.
 */
export interface Store {
  /** The text of the project's `.env`, or undefined when there is none or it cannot be read. */
  readonly read: (directory: string) => Effect.Effect<string | undefined>
  /**
   * Rewrites the file with `edit` applied to its text, creating it and ignoring it in git on first use. False when
   * nothing was written: `edit` declined, or the file system refused.
   */
  readonly update: (directory: string, edit: (text: string) => string | undefined) => Effect.Effect<boolean>
}

const LINE = /^(\s*(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_.-]*)([ \t]*=[ \t]*)(.*)$/

/** The variable a reference name stands for when the file does not have one yet: `github-token` is `GITHUB_TOKEN`. */
export const variable = (name: string) => {
  const upper = name.toUpperCase().replaceAll("-", "_")
  return /^[0-9]/.test(upper) ? `SECRET_${upper}` : upper
}

/**
 * `value` as one `.env` line can carry it, or undefined when it cannot: a line break in a single-quoted value or
 * a value holding both kinds of quote would not read back as it was written. `$` and backslashes keep a value out
 * of double quotes because many dotenv readers expand them there.
 */
export const format = (value: string) => {
  if (value === "" || value.includes("\r") || value.includes("\0")) return undefined
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  if (!/["\\$`]/.test(value)) return `"${value.replaceAll("\n", "\\n")}"`
  if (!value.includes("'") && !value.includes("\n")) return `'${value}'`
  return undefined
}

/** `text` with `name` set to `value`, keeping every other line, or undefined when the value cannot be written. */
export const upsert = (text: string, name: string, value: string) => {
  const formatted = format(value)
  if (formatted === undefined) return undefined
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((line) => variableOf(line) === name)
  if (index >= 0) {
    const match = LINE.exec(lines[index])
    // A value that opens a quote it does not close spans several lines; rewriting one line would corrupt the rest.
    if (!match || spansLines(match[4])) return undefined
    return lines.with(index, `${match[1]}${match[2]}=${formatted}`).join(eol)
  }
  const body = text === "" || text.endsWith("\n") ? text : text + eol
  return `${body}${variable(name)}=${formatted}${eol}`
}

/** `text` without the line that sets `name`. */
export const remove = (text: string, name: string) => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  return text
    .split(/\r?\n/)
    .filter((line) => variableOf(line) !== name)
    .join(eol)
}

/** `.gitignore` text with `.env` added, or undefined when it already ignores it. */
export const ignored = (text: string) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  if (lines.some((line) => line === ".env" || line === "/.env" || line === ".env*" || line === "**/.env"))
    return undefined
  const body = text === "" || text.endsWith("\n") ? text : text + "\n"
  return `${body}.env\n`
}

/** The reference name of the variable a line sets. */
function variableOf(line: string) {
  const match = LINE.exec(line)
  return match ? sanitize(match[2]) : undefined
}

function spansLines(raw: string) {
  const value = raw.trim()
  const quote = value[0]
  return (quote === '"' || quote === "'") && value.indexOf(quote, 1) < 0
}

/**
 * The repository root of `directory`, where its `.env` belongs: the nearest ancestor with a `.git` directory, the main
 * checkout for a linked worktree, or `directory` itself outside a repository.
 */
export async function root(directory: string) {
  let current = directory
  for (;;) {
    const git = path.join(current, ".git")
    const stat = await fs.stat(git).catch(() => undefined)
    if (stat?.isDirectory()) return current
    if (stat?.isFile()) return (await mainCheckout(current, git)) ?? current
    const parent = path.dirname(current)
    if (parent === current) return directory
    current = parent
  }
}

// A linked worktree's `.git` file reads `gitdir: <main>/.git/worktrees/<name>`.
async function mainCheckout(worktree: string, file: string) {
  const text = await fs.readFile(file, "utf8").catch(() => undefined)
  const gitdir = text ? /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim() : undefined
  if (!gitdir) return undefined
  const parts = path.resolve(worktree, gitdir).split(path.sep)
  const index = parts.lastIndexOf("worktrees")
  return index > 0 ? path.dirname(parts.slice(0, index).join(path.sep) || path.sep) : undefined
}

/** The file system store, resolving each directory's repository root once. */
export const store = (): Store => {
  const roots = new Map<string, Promise<string>>()
  const locate = (directory: string) => {
    const known = roots.get(directory)
    if (known) return known
    const found = root(directory)
    roots.set(directory, found)
    return found
  }
  const read = (directory: string) =>
    Effect.promise(async () => {
      const file = path.join(await locate(directory), ".env")
      return fs.readFile(file, "utf8").catch(() => undefined)
    })
  return {
    read,
    update: (directory, edit) =>
      Effect.promise(async () => {
        const base = await locate(directory)
        const file = path.join(base, ".env")
        const current = await fs.readFile(file, "utf8").catch(() => undefined)
        const next = edit(current ?? "")
        if (next === undefined) return false
        if (next === current) return true
        const written = await write(file, next).then(
          () => true,
          () => false,
        )
        if (written) await ignore(base)
        return written
      }),
  }
}

// Rename over the file so a reader never sees half of it; a new file is private to the user.
async function write(file: string, text: string) {
  const mode = await fs.stat(file).then(
    (stat) => stat.mode & 0o777,
    () => 0o600,
  )
  const temporary = `${file}.${process.pid}.tmp`
  await fs.writeFile(temporary, text, { mode })
  await fs.rename(temporary, file).catch(async (error) => {
    await fs.rm(temporary, { force: true })
    throw error
  })
}

// Only inside a repository: elsewhere there is no git to leak the file to.
async function ignore(base: string) {
  if (!(await fs.stat(path.join(base, ".git")).catch(() => undefined))) return
  const file = path.join(base, ".gitignore")
  const current = (await fs.readFile(file, "utf8").catch(() => undefined)) ?? ""
  const next = ignored(current)
  if (next !== undefined) await fs.writeFile(file, next).catch(() => undefined)
}
