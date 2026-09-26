import { EOL } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { canonical, git, inventory } from "./inventory"
import { project } from "./shared"

export default Runtime.handler(
  Commands.commands.worktrees.commands.remove,
  Effect.fn("cli.worktrees.remove")(function* (args) {
    const context = yield* project()
    yield* Effect.promise(() => context.client.worktree.refresh({ projectID: context.projectID }))
    const result = yield* inventory()
    const targets = new Set([
      yield* Effect.promise(() => canonical(path.resolve(args.target))),
      ...(result.root ? [yield* Effect.promise(() => canonical(path.resolve(result.root, args.target)))] : []),
    ])
    const matches = result.worktrees.filter((entry) =>
      targets.has(entry.path) || entry.branch === args.target || path.basename(entry.path) === args.target,
    )
    if (matches.length === 0) return yield* Effect.fail(new Error(`No worktree matches ${args.target}`))
    if (matches.length > 1) return yield* Effect.fail(new Error(`More than one worktree matches ${args.target}; use its full path`))
    const entry = matches[0]!
    if (entry.primary) return yield* Effect.fail(new Error(`Cannot remove the primary checkout: ${entry.path}`))
    if (entry.current) return yield* Effect.fail(new Error(`Cannot remove a worktree with a recent session: ${entry.path}`))
    if (!entry.registered || !entry.strategy)
      return yield* Effect.fail(new Error(`Worktree is not managed by V2: ${entry.path}`))
    if (entry.strategy === "git" && entry.changes === undefined)
      return yield* Effect.fail(new Error(`Cannot verify Git changes in ${entry.path}`))
    if (entry.changes && entry.changes.tracked + entry.changes.untracked > 0 && !args.force)
      return yield* Effect.fail(new Error(`Worktree has uncommitted changes; use --force to remove ${entry.path}`))
    const branch = entry.branch
    const root = result.root
    if (args.deleteBranch && (!branch || entry.merged !== true || !root))
      return yield* Effect.fail(new Error(`Cannot verify that ${entry.branch ?? entry.path} is merged`))
    yield* Effect.promise(() => context.client.worktree.remove({
      projectID: context.projectID,
      directory: entry.path,
      force: args.force,
    }))
    if (args.deleteBranch && branch && root) {
      const deleted = yield* Effect.promise(() => git(root, ["branch", "-D", branch], true))
      if (deleted.exit !== 0) return yield* Effect.fail(new Error(`Removed ${entry.path}, but could not delete ${branch}: ${deleted.error.trim()}`))
    }
    process.stdout.write(`Removed ${entry.path}${args.deleteBranch ? ` and branch ${entry.branch}` : ""}${EOL}`)
  }),
)
