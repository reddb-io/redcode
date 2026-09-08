export * as DesignRaster from "./raster"

import { Effect, Semaphore } from "effect"
import { Design } from "@reddb-io/redcode-schema/design"

declare const REDCODE_DESIGN_WORKER_PATH: string

export type Request =
  | { type: "frame"; png: Uint8Array; frame: number; fps: number; repeat: number; transparent: boolean }
  | { type: "finish" }
  | { type: "compare"; before: Uint8Array; after: Uint8Array }
export type Message = { id: number; input: Request }
export type Response = { id: number } & (
  | { type: "ok"; value: Uint8Array | number | null }
  | { type: "error"; message: string }
)

/** One request in flight per render: frames cannot build an unbounded worker queue. */
export const make = Effect.gen(function* () {
  const lock = yield* Semaphore.make(1)
  const sequence = { value: 0 }
  const worker = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new Worker(
          typeof REDCODE_DESIGN_WORKER_PATH === "undefined"
            ? new URL("./raster-worker.ts", import.meta.url)
            : REDCODE_DESIGN_WORKER_PATH,
        ),
    ),
    (worker) => Effect.sync(() => worker.terminate()),
  )
  const request = (input: Request, transfer = false) =>
    Effect.callback<Uint8Array | number | null, Design.Error>((resume) => {
      const id = sequence.value++
      const message = (event: MessageEvent<Response>) => {
        if (event.data.id !== id) return
        resume(
          event.data.type === "error"
            ? Effect.fail(new Design.Error({ code: "unavailable", message: event.data.message }))
            : Effect.succeed(event.data.value),
        )
      }
      const error = () =>
        resume(Effect.fail(new Design.Error({ code: "unavailable", message: "Raster worker stopped" })))
      worker.addEventListener("message", message)
      worker.addEventListener("error", error)
      worker.addEventListener("close", error)
      const buffers: ArrayBuffer[] = []
      const own = (bytes: Uint8Array) => {
        const data =
          transfer &&
          bytes.buffer instanceof ArrayBuffer &&
          bytes.byteOffset === 0 &&
          bytes.byteLength === bytes.buffer.byteLength
            ? bytes
            : Uint8Array.from(bytes)
        if (data.buffer instanceof ArrayBuffer) buffers.push(data.buffer)
        return data
      }
      const payload =
        input.type === "frame"
          ? { ...input, png: own(input.png) }
          : input.type === "compare"
            ? { ...input, before: own(input.before), after: own(input.after) }
            : input
      worker.postMessage({ id, input: payload } satisfies Message, [...new Set(buffers)])
      return Effect.sync(() => {
        worker.removeEventListener("message", message)
        worker.removeEventListener("error", error)
        worker.removeEventListener("close", error)
      })
    }).pipe(
      Effect.timeout("15 seconds"),
      Effect.catchTag("TimeoutError", () =>
        Effect.fail(new Design.Error({ code: "unavailable", message: "Raster worker timed out" })),
      ),
      lock.withPermits(1),
    )
  return {
    frame: (input: Omit<Extract<Request, { type: "frame" }>, "type">, transfer = false) =>
      request({ type: "frame", ...input }, transfer),
    finish: () =>
      request({ type: "finish" }).pipe(
        Effect.map((value) => {
          if (!(value instanceof Uint8Array)) throw new Error("Invalid GIF worker result")
          return value
        }),
      ),
    compare: (before: Uint8Array, after: Uint8Array, transfer = false) =>
      request({ type: "compare", before, after }, transfer).pipe(
        Effect.map((value) => {
          if (typeof value !== "number") throw new Error("Invalid raster comparison result")
          return value
        }),
      ),
  }
})
