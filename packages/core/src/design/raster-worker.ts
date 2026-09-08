/// <reference lib="webworker" />
/// <reference path="./gifenc.d.ts" />
import { GIFEncoder, quantize, applyPalette } from "gifenc"
import { PNG } from "pngjs"
import type { DesignRaster } from "./raster"

const encoder = GIFEncoder()
const state = { frames: 0 }

function decode(bytes: Uint8Array, limit: number) {
  if (bytes.byteLength > 25 * 1024 * 1024) throw new Error("Raster input exceeds 25 MB")
  const buffer = Buffer.from(bytes)
  // Bound allocations before the synchronous PNG decoder allocates its pixel buffer.
  if (buffer.length < 24 || buffer.readUInt32BE(16) > limit || buffer.readUInt32BE(20) > limit)
    throw new Error("Raster dimensions exceed the render limit")
  return PNG.sync.read(buffer)
}

self.onmessage = (event: MessageEvent<DesignRaster.Message>) => {
  try {
    const input = event.data.input
    if (input.type === "compare") {
      const before = decode(input.before, 2048)
      const after = decode(input.after, 2048)
      if (before.width !== after.width || before.height !== after.height)
        throw new Error("Comparison dimensions differ")
      const count = { changed: 0 }
      for (let pixel = 0; pixel < before.data.length; pixel += 4)
        if ([0, 1, 2].some((channel) => Math.abs(before.data[pixel + channel] - after.data[pixel + channel]) > 16))
          count.changed++
      self.postMessage({
        id: event.data.id,
        type: "ok",
        value: (100 * count.changed) / (before.width * before.height),
      } satisfies DesignRaster.Response)
      return
    }
    if (input.type === "finish") {
      encoder.finish()
      const bytes = encoder.bytes()
      self.postMessage({ id: event.data.id, type: "ok", value: bytes } satisfies DesignRaster.Response, [bytes.buffer])
      return
    }
    if (input.frame !== state.frames || state.frames >= 250 || input.fps < 1 || input.fps > 25)
      throw new Error("Invalid GIF frame sequence")
    const png = decode(input.png, 1024)
    const palette = quantize(png.data, 256, { format: "rgba4444", oneBitAlpha: true })
    const transparentIndex = palette.findIndex((color) => color[3] === 0)
    encoder.writeFrame(applyPalette(png.data, palette, "rgba4444"), png.width, png.height, {
      palette,
      delay: (Math.round(((input.frame + 1) * 100) / input.fps) - Math.round((input.frame * 100) / input.fps)) * 10,
      repeat: input.repeat,
      transparent: input.transparent && transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 2,
    })
    if (encoder.bytesView().byteLength > 100 * 1024 * 1024) throw new Error("GIF export exceeds 100 MB")
    state.frames++
    self.postMessage({ id: event.data.id, type: "ok", value: null } satisfies DesignRaster.Response)
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies DesignRaster.Response)
  }
}
