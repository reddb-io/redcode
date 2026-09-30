import { EOL } from "node:os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { WorktreeInventory } from "@opencode/core/worktree/inventory"
import { inventory } from "./inventory"

export default Runtime.handler(
  Commands.commands.worktrees.commands.list,
  Effect.fn("cli.worktrees.list")(function* (args) {
    const result = yield* inventory()
    if (args.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + EOL)
      return
    }
    const rows = result.worktrees.map((entry) => {
      const details = [
        WorktreeInventory.state(entry),
        entry.temporary ? "tmp" : undefined,
        entry.current ? "current" : undefined,
        entry.locked ? "locked" : undefined,
        entry.registered ? undefined : "unregistered",
        entry.sessions.length ? `${entry.sessions.length} sessions` : undefined,
      ].filter(Boolean).join(" · ")
      return [
        entry.relative ?? (entry.primary ? "primary checkout" : entry.path),
        entry.branch ?? (entry.head.slice(0, 7) || "-"),
        WorktreeInventory.size(entry) ?? "-",
        details,
      ]
    })
    const widths = [0, 1, 2].map((column) => Math.max(0, ...rows.map((row) => (row[column] ?? "").length)))
    process.stdout.write(rows.map((row) => row.map((cell, index) =>
      index < 3 ? cell.padEnd(widths[index] ?? 0) : cell,
    ).join("  ").trimEnd()).join(EOL) + EOL)
  }),
)
