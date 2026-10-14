import path from "node:path"
import { Effect, Option, Schema } from "effect"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { AgentTools } from "@opencode/schema/agent-tools"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(
  Commands.commands.tools,
  Effect.fn("cli.tools")(function* (input) {
    const action = Option.getOrElse(input.action, () => "list")
    if (!["list", "install", "enable", "disable", "configure", "probe", "init"].includes(action))
      return yield* Effect.fail(new Error("Choose list, install, enable, disable, configure, probe or init"))
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    const api = client.agentTools
    const snapshot = yield* Effect.tryPromise({ try: (signal) => api.list({ signal }), catch: (error) => error })
    if (action === "list") {
      process.stdout.write(`${snapshot.host.name} (${snapshot.host.platform}/${snapshot.host.arch})\n`)
      snapshot.tools.forEach((tool) =>
        process.stdout.write(
          `${tool.id}\t${tool.settings.enabled ? "enabled" : "disabled"}\t${!tool.supported ? "unsupported" : tool.installed ? "installed" : "not installed"}\n`,
        ),
      )
      return
    }
    const id = yield* Schema.decodeUnknownEffect(AgentTools.ID)(Option.getOrUndefined(input.id)).pipe(
      Effect.mapError(() => new Error("Choose rift, browser-control, terminal-control or computer-use")),
    )
    const item = snapshot.tools.find((tool) => tool.id === id)!
    const result = yield* Effect.tryPromise({
      try: async (signal) => {
        if (action === "install") return api.install({ id }, { signal })
        if (action === "probe") return api.probe({ id }, { signal })
        if (action === "init") {
          if (id !== "rift") throw new Error("Workspace initialization applies only to Rift")
          if (Option.isSome(input.server) && Option.isNone(input.directory))
            throw new Error("Pass --directory with an absolute path on the connected host")
          return api.initialize(
            {
              directory: Option.isSome(input.server)
                ? Option.getOrElse(input.directory, () => process.cwd())
                : path.resolve(Option.getOrElse(input.directory, () => process.cwd())),
            },
            { signal },
          )
        }
        const command = Option.isSome(input.command)
          ? Schema.decodeUnknownSync(Schema.fromJsonString(AgentTools.Command))(input.command.value)
          : input.resetCommand
            ? undefined
            : item.settings.command
        const settings: AgentTools.Settings = {
          enabled: action === "enable" ? true : action === "disable" ? false : item.settings.enabled,
          ...(command ? { command } : {}),
          timeout: Option.getOrElse(input.timeout, () => item.settings.timeout ?? 120_000),
          copyAll: Option.getOrElse(input.copyAll, () => item.settings.copyAll ?? false),
        }
        return api.configure({ id, settings }, { signal })
      },
      catch: (error) => error,
    })
    process.stdout.write(JSON.stringify(result, null, 2) + "\n")
  }),
)
