import { EOL } from "node:os"
import { Effect, Schema } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { selfCommand } from "../../util/process"

const PullRequest = Schema.fromJsonString(Schema.Struct({
  body: Schema.NullOr(Schema.String),
  isCrossRepository: Schema.Boolean,
  headRepository: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  headRepositoryOwner: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  headRefName: Schema.String,
}))

export default Runtime.handler(
  Commands.commands.pr,
  Effect.fn("cli.pr")(function* (input) {
    if (input.number < 1) return yield* Effect.fail(new Error("PR number must be positive"))
    if (!Bun.which("gh")) return yield* Effect.fail(new Error("GitHub CLI (gh) is required"))
    const branch = `pr-${input.number}`
    process.stdout.write(`Fetching and checking out PR #${input.number}...${EOL}`)
    const checkout = yield* Effect.promise(() => command(["gh", "pr", "checkout", String(input.number), "--branch", branch]))
    if (checkout.exit !== 0)
      return yield* Effect.fail(new Error(`Failed to check out PR #${input.number}: ${checkout.error.trim()}`))

    const view = yield* Effect.promise(() => command([
      "gh", "pr", "view", String(input.number), "--json",
      "headRepository,headRepositoryOwner,isCrossRepository,headRefName,body",
    ]))
    const info = view.exit === 0 ? yield* Schema.decodeUnknownEffect(PullRequest)(view.output) : undefined
    if (info?.isCrossRepository && info.headRepository && info.headRepositoryOwner) {
      const remote = info.headRepositoryOwner.login
      const repository = info.headRepository.name
      const remotes = yield* Effect.promise(() => command(["git", "remote"]))
      if (remotes.exit === 0 && !remotes.output.split("\n").includes(remote)) {
        const added = yield* Effect.promise(() => command([
          "git", "remote", "add", remote, `https://github.com/${remote}/${repository}.git`,
        ]))
        if (added.exit !== 0)
          return yield* Effect.fail(new Error(`Could not add fork remote ${remote}: ${added.error.trim()}`))
        process.stdout.write(`Added fork remote ${remote}${EOL}`)
      }
      const fetched = yield* Effect.promise(() => command([
        "git", "fetch", remote, `+refs/heads/${info.headRefName}:refs/remotes/${remote}/${info.headRefName}`,
      ]))
      if (fetched.exit === 0) {
        const upstream = yield* Effect.promise(() => command([
          "git", "branch", `--set-upstream-to=${remote}/${info.headRefName}`, branch,
        ]))
        if (upstream.exit !== 0) process.stderr.write(`Could not set fork upstream: ${upstream.error.trim()}${EOL}`)
      } else process.stderr.write(`Could not fetch fork branch: ${fetched.error.trim()}${EOL}`)
    }
    const share = info?.body?.match(/https:\/\/opncd\.ai\/s\/[a-zA-Z0-9_-]+/)?.[0]
    const imported = share
      ? yield* Effect.promise(() => command([...selfCommand(), "session", "import", share])).pipe(
          Effect.map((result) => result.exit === 0 ? result.output.match(/Imported session: ([a-zA-Z0-9_-]+)/)?.[1] : undefined),
        )
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

async function command(args: string[]) {
  const child = Bun.spawn(args, {
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: args[0] === "git"
      ? Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")))
      : process.env,
  })
  const [output, error, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { output, error, exit }
}
