import { expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { PNG } from "pngjs"
import { decompressFrames, parseGIF } from "gifuct-js"
import { DesignRaster } from "../src/design/raster"
import { it } from "./lib/effect"

const png = () => {
  const image = new PNG({ width: 64, height: 32 })
  image.data.fill(255)
  return PNG.sync.write(image)
}

it.live("encodes ordered GIF frames and compares PNGs in the raster worker", () =>
  Effect.gen(function* () {
    const raster = yield* DesignRaster.make
    const bytes = png()
    for (const frame of [0, 1, 2]) yield* raster.frame({ png: bytes, frame, fps: 25, repeat: 0, transparent: true })
    const gif = yield* raster.finish()
    const parsed = parseGIF(Uint8Array.from(gif).buffer)
    expect(parsed.lsd.width).toBe(64)
    expect(parsed.lsd.height).toBe(32)
    expect(decompressFrames(parsed, true).map((frame) => frame.delay)).toEqual([40, 40, 40])
    expect(yield* raster.compare(bytes, bytes)).toBe(0)
  }),
)

it.live("rejects oversized PNG allocations and unordered frames", () =>
  Effect.gen(function* () {
    const raster = yield* DesignRaster.make
    const bytes = png()
    bytes.writeUInt32BE(100000, 16)
    expect(
      (yield* raster.frame({ png: bytes, frame: 0, fps: 25, repeat: 0, transparent: false }).pipe(Effect.result))._tag,
    ).toBe("Failure")
    expect(
      (yield* raster.frame({ png: png(), frame: 1, fps: 25, repeat: 0, transparent: false }).pipe(Effect.result))._tag,
    ).toBe("Failure")
  }),
)

it.live("interrupts a raster scope and permits a fresh worker", () =>
  Effect.gen(function* () {
    const bytes = png()
    const running = yield* Effect.scoped(
      Effect.gen(function* () {
        const raster = yield* DesignRaster.make
        yield* raster.frame({ png: bytes, frame: 0, fps: 25, repeat: 0, transparent: false })
        yield* Effect.never
      }),
    ).pipe(Effect.forkChild)
    yield* Effect.sleep("20 millis")
    yield* Fiber.interrupt(running)
    const raster = yield* DesignRaster.make
    yield* raster.frame({ png: bytes, frame: 0, fps: 25, repeat: 0, transparent: false })
    expect((yield* raster.finish()).byteLength).toBeGreaterThan(0)
  }),
)

it.live("serializes concurrent raster requests and correlates their results", () =>
  Effect.gen(function* () {
    const raster = yield* DesignRaster.make
    const white = png()
    const black = new PNG({ width: 64, height: 32 })
    black.data.fill(0)
    const results = yield* Effect.all([raster.compare(white, white), raster.compare(white, PNG.sync.write(black))], {
      concurrency: "unbounded",
    })
    expect(results).toEqual([0, 100])
  }),
)

it.live("ignores replies for an interrupted request and transfers owned PNG buffers", () =>
  Effect.gen(function* () {
    const raster = yield* DesignRaster.make
    const bytes = png()
    const pending = yield* raster.compare(bytes, bytes).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Fiber.interrupt(pending)
    expect(yield* raster.compare(bytes, bytes)).toBe(0)
    const owned = Uint8Array.from(bytes)
    yield* raster.frame({ png: owned, frame: 0, fps: 25, repeat: 0, transparent: false }, true)
    expect(owned.byteLength).toBe(0)
    expect((yield* raster.finish()).byteLength).toBeGreaterThan(0)
  }),
)
