/**
 * Where a project keeps Redcode's own files.
 *
 * `.red/code` inside the repository, beside whatever else the RedDB family puts under `.red/`, the
 * same way the user-level home is `~/.red/code` next to `~/.red/redskilled`. Config, agents,
 * skills, themes, plugins, plans and designs all live there.
 *
 * Two older names are still read: `.redcode`, which this replaces, and `.opencode`, inherited from
 * upstream. Nothing is migrated on disk — a repository that has one keeps working, and a file
 * written into it stays where the person put it. The order below is what settles precedence when a
 * repository has more than one.
 */

import path from "path"

/** The one a new file goes into. */
export const DIR = path.join(".red", "code")

/** Read, never created: lowest precedence first. */
export const LEGACY_DIRS = [".opencode", ".redcode"]

/** Every project directory, lowest precedence first — the newer, closer name wins. */
export const DIRS = [...LEGACY_DIRS, DIR]

/** Highest precedence first, for a walk whose results are applied nearest-first. */
export const DIRS_PREFERRED_FIRST = [...DIRS].reverse()

const segments = (value: string) => value.split(/[\\/]+/).filter(Boolean)

/**
 * Does this path end in one of the project directories? Compared segment by segment, so a
 * directory that merely happens to be called `code` is not mistaken for `.red/code`.
 */
export function isProjectDir(dir: string): boolean {
  const parts = segments(dir)
  return DIRS.some((name) => {
    const want = segments(name)
    if (parts.length < want.length) return false
    return want.every((segment, index) => parts[parts.length - want.length + index] === segment)
  })
}

/**
 * The candidates for one path inside a project, best first: the current directory, then the older
 * names. A caller that writes takes the first; a caller that reads takes the first that exists.
 */
export function candidates(root: string, ...tail: string[]): string[] {
  return DIRS_PREFERRED_FIRST.map((dir) => path.join(root, dir, ...tail))
}

export * as ProjectDir from "./project-dir"
