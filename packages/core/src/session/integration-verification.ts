export * as SessionIntegrationVerification from "./integration-verification.js"

import { Effect } from "effect"
import type { Git } from "../git.js"
import type { AbsolutePath } from "../schema.js"

/** Ignored dependencies/build outputs are allowed; tracked or untracked source changes invalidate the check. */
export const observe = Effect.fnUntraced(function* (git: Git.Interface, directory: AbsolutePath, head: string) {
  const repository = yield* git.repo.discover(directory)
  if (!repository || (yield* git.history.head(repository)) !== head) return
  const status = yield* git.worktree.status(repository)
  return status?.changed === 0 ? repository.worktree : undefined
})
