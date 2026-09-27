export * as Formatter from "./formatter.js"

import { Context, Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import path from "path"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { AppProcess } from "@opencode/util/process"
import { Location } from "./location.js"
import type { Info } from "./formatter/builtins.js"
import { State } from "./state.js"

type Data = {
  formatters: Info[]
}

export type Editor = {
  set: (formatter: Info) => void
  remove: (name: string) => void
}

export interface Interface extends State.Transformable<Editor> {
  readonly status: () => Effect.Effect<{ name: string; extensions: string[]; enabled: boolean }[]>
  readonly file: (filepath: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Formatter") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service
    const commands = new WeakMap<Info, string[] | false>()
    const state = State.create<Data, Editor>({
      name: "formatter",
      initial: () => ({ formatters: [] }),
      editor: (editor) => ({
        set: (formatter) => {
          const index = editor.formatters.findIndex((item) => item.name === formatter.name)
          if (index === -1) editor.formatters.push(formatter)
          else editor.formatters[index] = formatter
        },
        remove: (name) => {
          editor.formatters = editor.formatters.filter((formatter) => formatter.name !== name)
        },
      }),
    })

    const command = Effect.fnUntraced(function* (formatter: Info) {
      const cached = commands.get(formatter)
      if (cached !== undefined) return cached
      const result = yield* formatter.enabled
      if (result !== false) commands.set(formatter, result)
      return result
    })

    const status = Effect.fn("Formatter.status")(function* () {
      return yield* Effect.forEach(state.get().formatters, (formatter) =>
        command(formatter).pipe(Effect.map((enabled) => ({
          name: formatter.name,
          extensions: [...formatter.extensions],
          enabled: enabled !== false,
        }))),
      )
    })

    const file = Effect.fn("Formatter.file")(function* (filepath: string) {
      const extension = path.extname(filepath)
      const matching = state.get().formatters.filter((formatter) => formatter.extensions.includes(extension))
      const enabled = (yield* Effect.forEach(matching, (formatter) =>
        command(formatter).pipe(Effect.map((cmd) => cmd === false ? undefined : { formatter, cmd })),
      )).filter((item): item is { formatter: Info; cmd: string[] } => item !== undefined)

      yield* Effect.reduce(enabled, false, (done, { formatter, cmd }) => Effect.gen(function* () {
        if (done) return true
        const replaced = cmd.map((argument) => argument.replace("$FILE", filepath))
        yield* Effect.logInfo("formatting file", { file: filepath, command: replaced })
        const result = yield* processes
          .run(
            ChildProcess.make(replaced[0], replaced.slice(1), {
              cwd: location.directory,
              env: formatter.environment,
              extendEnv: true,
              stdin: "ignore",
              stdout: "ignore",
              stderr: "ignore",
            }),
          )
          .pipe(
            Effect.catch((error) =>
              Effect.logError("failed to format file", {
                file: filepath,
                command: replaced,
                error: error.message,
              }).pipe(Effect.as(undefined)),
            ),
          )
        if (result?.exitCode === 0) return true
        if (!result) return false
        yield* Effect.logError("formatter exited unsuccessfully", {
          file: filepath,
          command: replaced,
          exitCode: result.exitCode,
        })
        return false
      }))
      return enabled.length > 0
    })

    return Service.of({ transform: state.transform, reload: state.reload, status, file })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, AppProcess.node],
})
