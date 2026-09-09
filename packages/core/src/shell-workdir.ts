export * as ShellWorkdir from "./shell-workdir"

import { Effect, Schema } from "effect"
import { FSUtil } from "./fs-util"

export class Invalid extends Schema.TaggedErrorClass<Invalid>()("ShellWorkdir.Invalid", {
  message: Schema.String,
}) {}

/** Validate before approval/spawn; failed calls never change the active directory. */
export const validate = Effect.fn("ShellWorkdir.validate")(function* (
  fs: FSUtil.Interface,
  directory: string,
  root: string,
) {
  const message = `Invalid working directory: ${directory.length > 240 ? directory.slice(0, 240) + "…" : directory}. Active session directory: ${root}. Omit workdir to recover there, inspect its directories, then use an existing absolute path. Do not retry or append to the invalid path. No command was executed.`
  const info = yield* fs.stat(directory).pipe(Effect.mapError(() => new Invalid({ message })))
  if (info.type !== "Directory") return yield* new Invalid({ message })
})
