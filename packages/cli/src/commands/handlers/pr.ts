import { EOL } from "node:os"
import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { selfCommand } from "../../util/process"

export default Runtime.handler(
  Commands.commands.pr,
  Effect.fn("cli.pr")(function* (input) {
    if (input.number < 1) return yield* Effect.fail(new Error("PR number must be positive"))
    const branch = `pr-${input.number}`
    process.stdout.write(`Fetching and checking out PR #${input.number}...${EOL}`)
    const checkout = yield* Effect.sync(() =>
      Bun.spawn(["gh", "pr", "checkout", String(input.number), "--branch", branch], {
        cwd: process.cwd(),
        stdout: "ignore",
        stderr: "pipe",
      }),
    )
    const checkoutCode = yield* Effect.promise(() => checkout.exited)
    if (checkoutCode !== 0) {
      const message = yield* Effect.promise(() => new Response(checkout.stderr).text())
      return yield* Effect.fail(new Error(`Failed to check out PR #${input.number}: ${message.trim()}`))
    }

    const view = yield* Effect.sync(() =>
      Bun.spawn(["gh", "pr", "view", String(input.number), "--json", "body", "--jq", ".body"], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "ignore",
      }),
    )
    const body = yield* Effect.promise(() => new Response(view.stdout).text())
    const viewCode = yield* Effect.promise(() => view.exited)
    const share = viewCode === 0 ? body.match(/https:\/\/opncd\.ai\/s\/[a-zA-Z0-9_-]+/)?.[0] : undefined
    const imported = share
      ? yield* Effect.promise(async () => {
          const child = Bun.spawn([...selfCommand(), "session", "import", share], {
            cwd: process.cwd(),
            stdout: "pipe",
            stderr: "pipe",
          })
          const output = await new Response(child.stdout).text()
          if ((await child.exited) !== 0) return undefined
          return output.match(/Imported session: ([a-zA-Z0-9_-]+)/)?.[1]
        })
      : undefined
    process.stdout.write(`Checked out PR #${input.number} as ${branch}${EOL}`)
    const tui = yield* Effect.sync(() =>
      Bun.spawn([...selfCommand(), ...(imported ? ["--session", imported] : [])], {
        cwd: process.cwd(),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }),
    )
    const code = yield* Effect.promise(() => tui.exited)
    if (code !== 0) process.exitCode = code
  }),
)
