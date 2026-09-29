import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { BootTrace } from "../../boot-trace"
import { applyReasoningFlag } from "../../reasoning-flag"

export default Runtime.handler(Commands.commands.run, (input) =>
  Effect.gen(function* () {
    const { runNonInteractive } = yield* Effect.promise(() => import("../../run/run"))
    const separator = process.argv.indexOf("--", 2)
    // A standalone server inherits it. A background service it spawns must not, so the Session's environment carries it there.
    if (input.tmp && input.standalone) process.env.REDCODE_WORKTREE_LOCATION = "tmp"
    // Set before the server resolves so the standalone server this run starts inherits it.
    yield* applyReasoningFlag(input)
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    BootTrace.mark("server.resolved", {
      mode: Option.isSome(input.server) ? "explicit" : input.standalone ? "standalone" : "service",
    })
    if (input.tmp) process.env.REDCODE_WORKTREE_LOCATION = "tmp"
    yield* Effect.promise(() =>
      runNonInteractive({
        server,
        message: [...input.message, ...(separator === -1 ? [] : process.argv.slice(separator + 1))],
        continue: input.continue,
        session: Option.getOrUndefined(input.session),
        fork: input.fork,
        model: Option.getOrUndefined(input.model),
        agent: Option.getOrUndefined(input.agent),
        format: input.format,
        file: [...input.file],
        title: Option.getOrUndefined(input.title),
        thinking: input.thinking,
        maxCost: Option.getOrUndefined(input.maxCost),
        maxTokens: Option.getOrUndefined(input.maxTokens),
        auto: input.auto || input.yolo || input.dangerouslySkipPermissions,
      }),
    )
  }),
)
