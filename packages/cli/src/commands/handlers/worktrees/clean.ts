import { confirm } from "@clack/prompts"
import { EOL } from "node:os"
import { Effect, Option, Result } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { prompt, requireInteractive } from "../../../ui/prompt"
import { bytes, git, inventory, removable } from "./inventory"
import { project } from "./shared"

export default Runtime.handler(
  Commands.commands.worktrees.commands.clean,
  Effect.fn("cli.worktrees.clean")(function* (input) {
    const stale = Option.getOrUndefined(input.stale)
    if (stale !== undefined && stale < 0) return yield* Effect.fail(new Error("--stale must be zero or greater"))
    const result = yield* inventory()
    const merged = input.merged || stale === undefined
    const cutoff = stale === undefined ? undefined : Date.now() - stale * 86_400_000
    const candidates = result.worktrees.filter((entry) => removable(entry, { merged, cutoff }))
    const prunable = result.worktrees.filter((entry) => entry.prunable)
    if (candidates.length === 0 && prunable.length === 0) {
      process.stdout.write(`Nothing to clean.${EOL}`)
      return
    }
    process.stdout.write(
      `${candidates.length} worktree(s), about ${bytes(candidates.reduce((sum, entry) => sum + entry.size, 0))} to free:${EOL}`,
    )
    candidates.forEach((entry) => process.stdout.write(`  ${entry.path}  ${entry.branch ?? entry.head.slice(0, 7)}${EOL}`))
    prunable.forEach((entry) => process.stdout.write(`  stale Git registration ${entry.path}${EOL}`))
    if (input.dryRun) return
    if (!input.yes) {
      yield* requireInteractive("Use --yes to clean without an interactive terminal, or --dry-run to preview.")
      const accepted = yield* prompt(() => confirm({ message: "Remove these worktrees?", initialValue: false }))
      if (!accepted) return
    }
    const context = yield* project()
    const root = result.root
    if (prunable.length && root) {
      const pruned = yield* Effect.promise(() => git(root, ["worktree", "prune"], true))
      if (pruned.exit !== 0) return yield* Effect.fail(new Error(`Could not prune Git registrations: ${pruned.error.trim()}`))
      yield* Effect.promise(() => context.client.worktree.refresh({ projectID: context.projectID }))
    }
    const outcomes = yield* Effect.forEach(candidates, (entry) =>
      Effect.tryPromise({
        try: () => context.client.worktree.remove({ projectID: context.projectID, directory: entry.path, force: false }),
        catch: (cause) => cause,
      }).pipe(Effect.result),
    )
    process.stdout.write(`Removed ${outcomes.filter(Result.isSuccess).length} worktree(s).${EOL}`)
    outcomes.forEach((outcome, index) => {
      if (Result.isFailure(outcome)) process.stderr.write(`  kept ${candidates[index]!.path}: ${String(outcome.failure)}${EOL}`)
    })
    if (outcomes.some(Result.isFailure)) process.exitCode = 1
    if (!root) return
    const branches = candidates.flatMap((entry, index) => {
      const outcome = outcomes[index]
      return outcome && Result.isSuccess(outcome) && entry.merged && entry.branch ? [entry.branch] : []
    })
    const deleted = yield* Effect.forEach(branches, (branch) =>
      Effect.promise(() => git(root, ["branch", "-D", branch], true)),
    )
    deleted.forEach((outcome, index) => {
      if (outcome.exit === 0) return
      process.stderr.write(`  could not delete branch ${branches[index]}: ${outcome.error.trim()}${EOL}`)
      process.exitCode = 1
    })
  }),
)
