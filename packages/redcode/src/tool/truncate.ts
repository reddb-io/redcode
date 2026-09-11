import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { NodePath } from "@effect/platform-node"
import { Cause, Duration, Effect, Layer, Option, Schedule, Context } from "effect"
import path from "path"
import type { Agent } from "../agent/agent"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { evaluate } from "@/permission/evaluate"
import { Config } from "@/config/config"
import { ToolID } from "./schema"
import { TRUNCATION_DIR } from "./truncation-dir"

const RETENTION = Duration.days(7)

export const MAX_LINES = 2000
export const MAX_BYTES = 50 * 1024
export const DIR = TRUNCATION_DIR
export const GLOB = path.join(TRUNCATION_DIR, "*")

/** `outputPath` is absent when the full text could not be retained; the preview is then all there is. */
export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath?: string }

export interface Options {
  maxLines?: number
  maxBytes?: number
  direction?: "head" | "tail"
}

function hasTaskTool(agent?: Agent.Info) {
  if (!agent?.permission) return false
  return evaluate("task", "*", agent.permission).action !== "deny"
}

export interface Interface {
  readonly cleanup: () => Effect.Effect<void>
  readonly write: (text: string) => Effect.Effect<string>
  /**
   * Returns output unchanged when it fits within the limits, otherwise writes the full text
   * to the truncation directory and returns a preview plus a hint to inspect the saved file.
   *
   * A store that refuses the write does not fail the call: the tool's own work succeeded, and
   * that is what the session records. The preview is returned alone, its notice says the rest is
   * gone, and the storage failure is logged for whoever runs the machine.
   */
  readonly output: (text: string, options?: Options, agent?: Agent.Info) => Effect.Effect<Result>
  /**
   * Resolved truncation limits: values from `tool_output` in Redcode config, or MAX_LINES / MAX_BYTES if unset.
   */
  readonly limits: () => Effect.Effect<{ maxLines: number; maxBytes: number }>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/Truncate") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const cleanup = Effect.fn("Truncate.cleanup")(function* () {
      const cutoff = Date.now() - Duration.toMillis(RETENTION)
      const entries = yield* fs.readDirectory(TRUNCATION_DIR).pipe(
        Effect.map((all) => all.filter((name) => name.startsWith("tool_"))),
        Effect.catch(() => Effect.succeed([])),
      )
      for (const entry of entries) {
        const file = path.join(TRUNCATION_DIR, entry)
        const info = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const mtime = info && Option.getOrUndefined(info.mtime)
        if (!mtime || mtime.getTime() >= cutoff) continue
        yield* fs.remove(file).pipe(Effect.catch(() => Effect.void))
      }
    })

    const retain = Effect.fn("Truncate.retain")(function* (text: string) {
      const file = path.join(TRUNCATION_DIR, ToolID.ascending())
      yield* fs.ensureDir(TRUNCATION_DIR)
      yield* fs.writeFileString(file, text)
      return file
    })

    const write = Effect.fn("Truncate.write")(function* (text: string) {
      return yield* retain(text).pipe(Effect.orDie)
    })

    const limits = Effect.fn("Truncate.limits")(function* () {
      const configSvc = yield* Effect.serviceOption(Config.Service)
      if (Option.isNone(configSvc)) return { maxLines: MAX_LINES, maxBytes: MAX_BYTES }
      const cfg = yield* configSvc.value.get().pipe(Effect.catch(() => Effect.succeed(undefined)))
      return {
        maxLines: cfg?.tool_output?.max_lines ?? MAX_LINES,
        maxBytes: cfg?.tool_output?.max_bytes ?? MAX_BYTES,
      }
    })

    const output = Effect.fn("Truncate.output")(function* (text: string, options: Options = {}, agent?: Agent.Info) {
      const resolved = yield* limits()
      const maxLines = options.maxLines ?? resolved.maxLines
      const maxBytes = options.maxBytes ?? resolved.maxBytes
      const direction = options.direction ?? "head"
      const lines = text.split("\n")
      const totalBytes = Buffer.byteLength(text, "utf-8")

      if (lines.length <= maxLines && totalBytes <= maxBytes) {
        return { content: text, truncated: false } as const
      }

      const out: string[] = []
      let i = 0
      let bytes = 0
      let hitBytes = false

      if (direction === "head") {
        for (i = 0; i < lines.length && i < maxLines; i++) {
          const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
          if (bytes + size > maxBytes) {
            hitBytes = true
            break
          }
          out.push(lines[i])
          bytes += size
        }
      } else {
        for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
          const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
          if (bytes + size > maxBytes) {
            hitBytes = true
            break
          }
          out.unshift(lines[i])
          bytes += size
        }
      }

      const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
      const unit = hitBytes ? "bytes" : "lines"
      const preview = out.join("\n")
      const file = yield* retain(text).pipe(
        Effect.catch((error) =>
          Effect.logWarning("truncated tool output could not be retained", {
            dir: TRUNCATION_DIR,
            error: String(error),
          }).pipe(Effect.as(undefined)),
        ),
      )

      const hint =
        file === undefined
          ? "The tool call succeeded but the output was truncated, and the full output could not be saved to a file. Only the portion shown here is available; narrow the request or filter its output to see more."
          : hasTaskTool(agent)
            ? `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
            : `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`

      return {
        content:
          direction === "head"
            ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
            : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`,
        truncated: true,
        ...(file === undefined ? {} : { outputPath: file }),
      } as const
    })

    yield* cleanup().pipe(
      Effect.catchCause((cause) => Effect.logError("truncation cleanup failed", { cause: Cause.pretty(cause) })),
      Effect.repeat(Schedule.spaced(Duration.hours(1))),
      Effect.delay(Duration.minutes(1)),
      Effect.forkScoped,
    )

    return Service.of({ cleanup, write, output, limits })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node] })

export * as Truncate from "./truncate"
