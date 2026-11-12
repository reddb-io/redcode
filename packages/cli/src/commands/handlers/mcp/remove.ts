import { EOL } from "node:os"
import path from "node:path"
import { Effect, Option } from "effect"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { configCandidates, definitionPaths, editConfig, readConfig, writeConfig } from "./config"

export default Runtime.handler(
  Commands.commands.mcp.commands.remove,
  Effect.fn("cli.mcp.remove")(function* (input) {
    const explicit = Option.getOrUndefined(input.config)
    if (explicit && input.global) return yield* Effect.fail(new Error("Choose --global or --config <file>, not both"))
    const global = yield* Global.Service
    const files = explicit
      ? [path.resolve(explicit)]
      : configCandidates(input.global ? global.config : process.cwd(), input.global, global.config)
    const plan = yield* Effect.tryPromise({
      try: () =>
        Promise.all(
          files.map(async (file) => {
            const document = await readConfig(file)
            const keys = document ? definitionPaths(document, input.name) : []
            return document && keys.length
              ? { file, text: keys.reduce((text, key) => editConfig(text, key, undefined), document.text) }
              : undefined
          }),
        ),
      catch: (cause) => cause,
    })
    const changed = plan.filter((item) => item !== undefined)
    if (!changed.length)
      return yield* Effect.fail(
        new Error(
          `MCP server "${input.name}" was not found in the selected ${explicit ? "file" : input.global ? "global" : "project"} configuration. Inherited, explicit or managed definitions are not removed. Use --global or --config <file> to select their authored source.`,
        ),
      )
    yield* Effect.tryPromise({
      try: () => Promise.all(changed.map((item) => writeConfig(item.file, item.text))),
      catch: (cause) => cause,
    })
    process.stdout.write(
      `MCP server "${input.name}" removed from ${changed.map((item) => item.file).join(", ")}. Saved credentials were preserved.` +
        EOL,
    )
    process.stdout.write(
      "Other configuration scopes can still define this MCP. Reload a running project's MCPs with redcode mcp reload; use redcode mcp logout to remove saved OAuth credentials separately." +
        EOL,
    )
  }),
)
