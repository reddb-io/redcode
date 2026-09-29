export * as WorktreePlacement from "./placement.js"

import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import type { ConfigWorktree } from "@opencode/schema/config/worktree"

type Environment = Readonly<Record<string, string | undefined>>

/** Temporary session worktrees live at `<tmpdir>/redcode-worktrees/<repository>-<hash>/<name>`. */
export const TEMPORARY = "redcode-worktrees"

/** File in a linked worktree's Git directory naming the root Session that owns it. */
export const OWNER = "redcode-session"

/**
 * The environment that governs a Session's worktree: the one its client sent (a terminal started with
 * `--tmp` carries `REDCODE_WORKTREE_LOCATION=tmp`), else the server's own. A background service keeps
 * whatever environment first started it, so a client environment never falls back to it.
 */
export function environment(session: Environment | undefined, server: Environment) {
  return session ?? server
}

/** The value of `REDCODE_<name>`, else the `OPENCODE_<name>` spelling, ignoring empty values. */
export function value(name: string, environment: Environment) {
  return [environment[`REDCODE_${name}`], environment[`OPENCODE_${name}`]].find(
    (item): item is string => item !== undefined && item !== "",
  )
}

/** `worktree.auto: false` and `REDCODE_AUTO_WORKTREE=0` each turn automatic worktrees off. */
export function automatic(settings: ConfigWorktree.Info | undefined, environment: Environment) {
  return settings?.auto !== false && value("AUTO_WORKTREE", environment) !== "0"
}

/** `--tmp` and `REDCODE_WORKTREE_LOCATION` override `worktree.location`; the default is the repository. */
export function location(settings: ConfigWorktree.Info | undefined, environment: Environment) {
  return (
    [value("WORKTREE_LOCATION", environment), settings?.location].find(
      (item): item is "repo" | "tmp" => item === "repo" || item === "tmp",
    ) ?? "repo"
  )
}

/** Where a repository's temporary session worktrees go under the temporary directory `tmpdir`. */
export function temporaryParent(root: string, tmpdir: string) {
  return path.join(
    tmpdir,
    TEMPORARY,
    `${path.basename(root)}-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`,
  )
}

/** The directory that receives a repository's automatic session worktrees. */
export function parent(input: {
  readonly root: string
  readonly settings?: ConfigWorktree.Info
  readonly environment: Environment
}) {
  if (location(input.settings, input.environment) === "tmp")
    return temporaryParent(input.root, input.settings?.tmpdir || os.tmpdir())
  if (input.settings?.directory) return path.resolve(input.root, input.settings.directory)
  return path.join(input.root, ".red", "worktrees")
}

/** Whether `directory` is a temporary session worktree or lies inside one. */
export function temporary(directory: string) {
  return directory.split(/[\\/]/).includes(TEMPORARY)
}

/**
 * Up to three words of `text` as a kebab-case worktree and branch name, or "task" when none survive.
 * Letters and digits of every script are kept; accents are dropped. Words of three or more characters
 * are preferred so short function words rarely lead the name, without a language-specific word list.
 */
export function slug(text: string) {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  const meaningful = words.filter((word) => [...word].length >= 3)
  return (
    (meaningful.length > 0 ? meaningful : words)
      .slice(0, 3)
      .map((word) => [...word].slice(0, 20).join(""))
      .join("-") || "task"
  )
}

/** The first of `name`, `name-2`, `name-3`, … that no branch or worktree directory already uses. */
export function nextName(name: string, taken: ReadonlySet<string>) {
  if (!taken.has(name)) return name
  const index = Array.from({ length: taken.size + 1 }, (_, offset) => offset + 2).find(
    (candidate) => !taken.has(`${name}-${candidate}`),
  )
  return `${name}-${index}`
}
