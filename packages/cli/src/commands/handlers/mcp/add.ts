import { EOL } from "node:os"
import path from "node:path"
import { Effect, Option } from "effect"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { configCandidates, definitionPaths, editConfig, readConfig, writeConfig } from "./config"

export default Runtime.handler(
  Commands.commands.mcp.commands.add,
  Effect.fn("cli.mcp.add")(function* (input) {
    const url = Option.getOrUndefined(input.url)
    const headers = Option.getOrUndefined(input.header)
    const environment = Option.getOrUndefined(input.env)
    const explicit = Option.getOrUndefined(input.config)
    if (explicit && input.global) return yield* Effect.fail(new Error("Choose --global or --config <file>, not both"))
    // The CLI framework strands `--` operands on the root command, so read the local server command
    // straight from argv after `--`. This also lets the command carry its own flags (e.g. `npx -y`).
    const dash = process.argv.indexOf("--")
    const command = dash === -1 ? [...input.command] : process.argv.slice(dash + 1)

    const hasCommand = command.length > 0
    if (url && hasCommand)
      return yield* Effect.fail(new Error("Provide either --url <url> or a command after --, not both"))
    if (!url && !hasCommand) return yield* Effect.fail(new Error("Provide either --url <url> or a command after --"))
    if (url && !URL.canParse(url)) return yield* Effect.fail(new Error(`Invalid URL: ${url}`))
    if (url && environment) return yield* Effect.fail(new Error("--env is only valid for local MCP servers"))
    if (hasCommand && headers) return yield* Effect.fail(new Error("--header is only valid for remote MCP servers"))

    const server = url
      ? { type: "remote" as const, url, ...(headers ? { headers } : {}) }
      : { type: "local" as const, command, ...(environment ? { environment } : {}) }

    const global = yield* Global.Service
    const configPath = explicit
      ? path.resolve(explicit)
      : yield* Effect.tryPromise({
          try: () => resolveConfigPath(input.global ? global.config : process.cwd(), input.global, global.config),
          catch: (cause) => cause,
        })
    yield* Effect.tryPromise({ try: () => write(configPath, input.name, server), catch: (cause) => cause })
    process.stdout.write(`MCP server "${input.name}" added to ${configPath}` + EOL)
    process.stdout.write("Reload a running project's MCPs with redcode mcp reload." + EOL)
  }),
)

export async function resolveConfigPath(directory: string, global = true, globalDirectory?: string) {
  if (!global && globalDirectory && path.relative(globalDirectory, directory) === "")
    throw new Error(
      "The current directory is the global configuration root. Choose --global or --config <file> explicitly.",
    )
  const candidates = configCandidates(directory, global, globalDirectory)
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  return global ? path.join(directory, "config.jsonc") : path.join(directory, "redcode.jsonc")
}

async function write(configPath: string, name: string, server: unknown) {
  const document = await readConfig(configPath)
  const text = document
    ? definitionPaths(document, name)
        .filter((key) => key.length === 2)
        .reduce((text, key) => editConfig(text, key, undefined), document.text)
    : "{}\n"
  await writeConfig(configPath, editConfig(text, ["mcp", "servers", name], server))
}
