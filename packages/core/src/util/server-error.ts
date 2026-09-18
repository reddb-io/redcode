export * as ServerError from "./server-error"

import path from "node:path"
import { Global } from "../global"
import { NamedError } from "./error"

/**
 * One line of what actually broke, for an error surface that can only show a message. A
 * `NamedError` carries its words in `.data.message` (its `.message` property is just its name);
 * a plain Error's `.message` is real unless it only restates its name. Never the stack.
 */
export function detail(error: unknown): string {
  const text =
    typeof error === "string"
      ? error
      : error instanceof NamedError
        ? (error.toObject().data as { message?: unknown } | undefined)?.message ?? error.name
        : error instanceof Error && error.message && error.message !== error.name
          ? error.message
          : error instanceof Error
            ? error.name
            : String(error)
  const line = (typeof text === "string" ? text : String(text)).split("\n")[0] ?? ""
  return line.length > 300 ? `${line.slice(0, 299)}…` : line
}

/**
 * The 500 message an unexpected server defect surfaces with: what broke, the correlation `ref`
 * matching the `failed` log entry, and the exact file holding the full cause. The log keeps the
 * complete picture; the response keeps to one cause line.
 */
export function message(ref: string, error: unknown): string {
  return `Unexpected server error (${ref}): ${detail(error)}. Details in ${path.join(Global.Path.log, "redcode.log")}`
}
