import type { Argv } from "yargs"
import { Effect } from "effect"
import * as prompts from "@clack/prompts"
import { WorktreeInventory } from "@reddb-io/redcode-core/worktree-inventory"
import { Session } from "@/session/session"
import { WorktreeSessions } from "@/worktree/sessions"
import { effectCmd, fail } from "../effect-cmd"

/** Sessions across projects: worktrees name the ones working in them, and recently active ones are kept. */
const sessionRows = Session.Service.use((sessions) => sessions.listGlobal({ limit: 1000 }))

const run = <A>(action: () => Promise<A>) =>
  Effect.tryPromise({ try: action, catch: (error) => error }).pipe(
    Effect.catch((error) => fail(error instanceof Error ? error.message : String(error))),
  )

const ListCommand = effectCmd({
  command: "list",
  describe: "list the repository's worktrees with size, changes and merge state",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("json", { type: "boolean", default: false, describe: "print the inventory as JSON" }),
  handler: Effect.fn("Cli.worktrees.list")(function* (args: { json: boolean }) {
    const rows = yield* sessionRows
    const inventory = WorktreeSessions.attach(
      yield* run(() =>
        WorktreeInventory.list({
          directory: process.cwd(),
          protect: WorktreeSessions.busy(rows),
          pullRequests: true,
        }),
      ),
      rows,
    )
    if (args.json) {
      console.log(JSON.stringify(inventory, null, 2))
      return
    }
    const now = Date.now()
    const table = inventory.worktrees.map((item) => {
      const summary = WorktreeInventory.summary(item, now)
      const sessions =
        item.sessions.length > 0 ? `  ${item.sessions.length} session${item.sessions.length === 1 ? "" : "s"}` : ""
      return [summary.location, summary.branch, summary.size, summary.state + sessions]
    })
    const widths = [0, 1, 2].map((column) => Math.max(...table.map((row) => row[column].length)))
    table.forEach((row) =>
      console.log(
        row
          .map((cell, index) => cell.padEnd(widths[index] ?? 0))
          .join("  ")
          .trimEnd(),
      ),
    )
  }),
})

const CleanCommand = effectCmd({
  command: "clean",
  describe: "remove clean worktrees whose branch merged or that went stale",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("merged", { type: "boolean", describe: "remove clean worktrees whose branch merged (the default)" })
      .option("stale", { type: "number", describe: "remove clean worktrees without activity for this many days" })
      .option("dry-run", { type: "boolean", default: false, describe: "only report what would be removed" })
      .option("yes", { alias: "y", type: "boolean", default: false, describe: "skip the confirmation prompt" }),
  handler: Effect.fn("Cli.worktrees.clean")(function* (args: {
    merged?: boolean
    stale?: number
    dryRun: boolean
    yes: boolean
  }) {
    const rows = yield* sessionRows
    const input = {
      directory: process.cwd(),
      merged: args.merged,
      staleDays: args.stale,
      protect: WorktreeSessions.busy(rows),
      pullRequests: true,
    }
    const preview = yield* run(() => WorktreeInventory.clean({ ...input, dryRun: true }))
    const lines = [
      ...preview.candidates.map((item) => {
        const summary = WorktreeInventory.summary(item)
        return `  ${summary.location}  ${summary.branch}  ${summary.size}`
      }),
      ...preview.pruned.map((name) => `  stale registration ${name}`),
    ]
    if (lines.length === 0) {
      console.log("Nothing to clean.")
      return
    }
    console.log(
      `${preview.candidates.length} worktree${preview.candidates.length === 1 ? "" : "s"}, ${WorktreeInventory.bytes(preview.freed)} to free:`,
    )
    lines.forEach((line) => console.log(line))
    if (args.dryRun) return
    if (!args.yes) {
      const confirmed = yield* Effect.promise(() => prompts.confirm({ message: "Remove them?" }))
      if (confirmed !== true) return
    }
    const result = yield* run(() => WorktreeInventory.clean(input))
    console.log(`Removed ${result.removed.length}, freed ${WorktreeInventory.bytes(result.freed)}.`)
    result.failed.forEach((item) => console.log(`  kept ${item.path}: ${item.message}`))
  }),
})

const RemoveCommand = effectCmd({
  command: "remove <target>",
  describe: "remove one worktree by path or branch; uncommitted changes need --force",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("target", { type: "string", demandOption: true, describe: "worktree path, name or branch" })
      .option("force", { type: "boolean", default: false, describe: "discard uncommitted changes" })
      .option("delete-branch", { type: "boolean", default: false, describe: "delete the branch when it is merged" }),
  handler: Effect.fn("Cli.worktrees.remove")(function* (args: {
    target: string
    force: boolean
    deleteBranch: boolean
  }) {
    const rows = yield* sessionRows
    const result = yield* run(() =>
      WorktreeInventory.remove({
        directory: process.cwd(),
        target: args.target,
        force: args.force,
        deleteBranch: args.deleteBranch,
        protect: WorktreeSessions.busy(rows),
        pullRequests: args.deleteBranch,
      }),
    )
    console.log(
      `Removed ${result.path}${result.branchDeleted ? ` and branch ${result.branch}` : ""}, freed ${WorktreeInventory.bytes(result.freed)}.`,
    )
  }),
})

export const WorktreesCommand = effectCmd({
  command: "worktrees",
  describe: "list and safely remove the repository's worktrees",
  instance: false,
  builder: (yargs: Argv) => yargs.command(ListCommand).command(CleanCommand).command(RemoveCommand).demandCommand(),
  handler: Effect.fn("Cli.worktrees")(function* () {}),
})
