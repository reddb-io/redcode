export * as SessionRepositoryStatus from "./repository-status.js"

import { Redact } from "@opencode/util/redact"
import { Effect } from "effect"
import type { Git } from "../git.js"
import type { AbsolutePath } from "../schema.js"

/** Discover from the Session directory, never the project's canonical/main checkout. */
export const capture = Effect.fn("SessionRepositoryStatus.capture")(function* (
  git: Git.Interface,
  directory: AbsolutePath,
) {
  const repository = yield* git.repo.discover(directory)
  if (!repository) return undefined
  const snapshot = yield* Effect.all(
    {
      branch: git.history.branch(repository),
      head: git.history.head(repository),
      status: git.worktree.status(repository),
    },
    { concurrency: "unbounded" },
  )
  if (!snapshot.status) return undefined
  return Redact.redact(
    [
      "## Repository Status",
      "Git snapshot at checkpoint completion; earlier repository status may be outdated.",
      `- Worktree: ${JSON.stringify(repository.worktree)} (${repository.gitDirectory === repository.commonDirectory ? "main" : "linked"})`,
      `- Branch: ${snapshot.branch ? JSON.stringify(snapshot.branch) : snapshot.head ? `detached HEAD at ${snapshot.head.slice(0, 12)}` : "(unavailable)"}`,
      `- Changed files: ${snapshot.status.changed} (${snapshot.status.changed - snapshot.status.untracked} tracked; ${snapshot.status.untracked} untracked)`,
      `- Tracked changes: ${snapshot.status.staged} staged; ${snapshot.status.unstaged} unstaged; ${snapshot.status.conflicted} conflicted (categories can overlap)`,
    ].join("\n"),
  )
})
