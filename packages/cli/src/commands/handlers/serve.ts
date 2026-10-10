import { Effect, Option, Schema } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerProcess } from "../../server-process"
import { applyReasoningFlag } from "../../reasoning-flag"

export default Runtime.handler(
  Commands.commands.serve,
  Effect.fnUntraced(function* (input) {
    if (input.service && input.stdio) return yield* Effect.fail(new Error("--service and --stdio cannot be combined"))
    // Sessions whose client sends no worktree location of its own use the server's.
    if (input.tmp) process.env.REDCODE_WORKTREE_LOCATION = "tmp"
    yield* applyReasoningFlag({ reasoning: input.reasoning, standalone: true })
    const accessConfig = Option.getOrUndefined(input.accessConfig)
    const access = accessConfig
      ? yield* Effect.promise(async () => {
          const { InfrastructureAccess } = await import("@opencode/server/infrastructure-access")
          return InfrastructureAccess.validate(
            Schema.decodeUnknownSync(InfrastructureAccess.Options)(await Bun.file(accessConfig).json()),
          )
        })
      : undefined
    return yield* ServerProcess.run({
      mode: input.service ? "service" : input.stdio ? "stdio" : "default",
      access,
      hostname: Option.getOrUndefined(input.hostname),
      port: Option.getOrUndefined(input.port),
      cors: input.cors.length > 0 ? input.cors : undefined,
    })
  }),
)
