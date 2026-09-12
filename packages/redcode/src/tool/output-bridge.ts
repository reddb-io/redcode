export * as ToolOutputBridge from "./output-bridge"

import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule } from "effect"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { Global } from "@reddb-io/redcode-core/global"
import type { SessionSchema } from "@reddb-io/redcode-core/session/schema"
import { ToolOutputStore } from "@reddb-io/redcode-core/tool-output-store"
import { ToolOutput } from "@reddb-io/redcode-llm"
import { Config } from "@/config/config"

/** The Managed Tool Output directory both runtimes write to and the read tools may open. */
export const DIR = path.join(Global.Path.data, ToolOutputStore.MANAGED_DIRECTORY)
export const GLOB = path.join(DIR, "*")
export const MAX_LINES = ToolOutputStore.MAX_LINES
export const MAX_BYTES = ToolOutputStore.MAX_BYTES

const LOSSY_NOTICE =
  "The tool call succeeded but the output was truncated, and the full output could not be saved to a file. Only the portion shown here is available; narrow the request or filter its output to see more."

/** `outputPath` is absent when the full text could not be retained; the preview is then all there is. */
export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath?: string }

export interface Interface {
  readonly limits: ToolOutputStore.Interface["limits"]
  /** Allocates one Managed Tool Output File for a caller that streams into it; dies when the store refuses. */
  readonly retain: (text: string) => Effect.Effect<string>
  /**
   * Returns the text unchanged when it fits the limits, otherwise the core store's bounded preview
   * with the Managed Tool Output File holding the complete text.
   *
   * A store that refuses the write does not fail the call: the tool's own work succeeded, and that
   * is what the session records. The preview is returned alone, its notice says the rest is gone,
   * and the storage failure is logged for whoever runs the machine.
   */
  readonly bound: (
    text: string,
    ctx: { readonly sessionID: SessionSchema.ID; readonly callID?: string },
  ) => Effect.Effect<Result>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/ToolOutputBridge") {}

const limits = Effect.fn("ToolOutputBridge.limits")(function* () {
  const config = yield* Effect.serviceOption(Config.Service)
  if (Option.isNone(config)) return { maxLines: MAX_LINES, maxBytes: MAX_BYTES }
  const cfg = yield* config.value.get().pipe(Effect.catch(() => Effect.succeed(undefined)))
  return {
    maxLines: cfg?.tool_output?.max_lines ?? MAX_LINES,
    maxBytes: cfg?.tool_output?.max_bytes ?? MAX_BYTES,
  }
})

/** Core's store with limits from Redcode config: the V2 runner's directory, file names, bounding and retention. */
export const storeNode = LayerNode.make({
  service: ToolOutputStore.Service,
  layer: ToolOutputStore.layerWith(limits()),
  deps: [FSUtil.node, Global.node],
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* ToolOutputStore.Service

    const bound = Effect.fn("ToolOutputBridge.bound")(function* (
      text: string,
      ctx: { readonly sessionID: SessionSchema.ID; readonly callID?: string },
    ) {
      const result = yield* store
        .bound({
          sessionID: ctx.sessionID,
          toolCallID: ctx.callID ?? "",
          output: ToolOutput.make({}, [{ type: "text", text }]),
        })
        .pipe(
          Effect.catchTag("ToolOutputStore.StorageError", (error) =>
            Effect.logWarning("managed tool output could not be retained", { dir: DIR, error: error.message }).pipe(
              Effect.as(undefined),
            ),
          ),
        )
      if (result === undefined) {
        const resolved = yield* store.limits()
        return {
          content: ToolOutputStore.boundedPreview(text, LOSSY_NOTICE, resolved.maxLines, resolved.maxBytes),
          truncated: true,
        } as const
      }
      const outputPath = result.outputPaths[0]
      if (outputPath === undefined) return { content: text, truncated: false } as const
      const preview = result.output.content[0]
      return { content: preview?.type === "text" ? preview.text : text, truncated: true, outputPath } as const
    })

    yield* store
      .cleanup()
      .pipe(Effect.repeat(Schedule.spaced(Duration.hours(1))), Effect.delay(Duration.minutes(1)), Effect.forkScoped)

    return Service.of({
      limits: store.limits,
      retain: (text) => store.retain(text).pipe(Effect.orDie),
      bound,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [storeNode] })
