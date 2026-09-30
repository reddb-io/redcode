import { confirm } from "@clack/prompts"
import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { WorktreeInventory } from "@opencode/core/worktree/inventory"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { prompt, requireInteractive } from "../../../ui/prompt"
import { inventory } from "./inventory"
import { project } from "./shared"

export default Runtime.handler(
  Commands.commands.worktrees.commands.clean,
  Effect.fn("cli.worktrees.clean")(function* (input) {
    const stale = Option.getOrUndefined(input.stale)
    if (stale !== undefined && stale < 0) return yield* Effect.fail(new Error("--stale must be zero or greater"))
    const result = yield* inventory()
    const merged = input.merged || stale === undefined
    const cutoff = stale === undefined ? undefined : Date.now() - stale * 86_400_000
    const candidates = result.worktrees.filter((entry) => WorktreeInventory.removable(entry, { merged, cutoff }))
    const prunable = result.worktrees.filter((entry) => entry.prunable)
    if (candidates.length === 0 && prunable.length === 0) {
      process.stdout.write(`Nothing to clean.${EOL}`)
      return
    }
    process.stdout.write(
      `${candidates.length} worktree(s), about ${WorktreeInventory.bytes(candidates.reduce((sum, entry) => sum + entry.size, 0))} to free:${EOL}`,
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
    const outcome = yield* Effect.tryPromise({
      try: () =>
        WorktreeInventory.clean({
          root: result.root,
          candidates,
          prunable,
          remove: (entry) =>
            context.client.worktree.remove({ projectID: context.projectID, directory: entry.path, force: false }),
          refresh: () => context.client.worktree.refresh({ projectID: context.projectID }),
        }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    process.stdout.write(`Removed ${outcome.removed.length} worktree(s).${EOL}`)
    outcome.kept.forEach((kept) => process.stderr.write(`  kept ${kept.entry.path}: ${String(kept.error)}${EOL}`))
    outcome.branches.forEach((failure) =>
      process.stderr.write(`  could not delete branch ${failure.branch}: ${failure.error}${EOL}`),
    )
    if (outcome.kept.length || outcome.branches.length) process.exitCode = 1
  }),
)
