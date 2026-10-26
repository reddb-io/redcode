export * as PhotonNormalize from "./photon-normalize.js"

import photonWasm from "#photon-wasm"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { FileSystem } from "../filesystem.js"
import type { Limits } from "../image.js"

export type Photon = Awaited<ReturnType<typeof load>>
export type Content = FileSystem.Content & { readonly encoding: "base64" }
export type Result =
  | { readonly _tag: "Unchanged" }
  | { readonly _tag: "Content"; readonly content: Content }
  | { readonly _tag: "DecodeError" }
  | {
      readonly _tag: "SizeError"
      readonly width: number
      readonly height: number
      readonly bytes: number
      readonly maxWidth: number
      readonly maxHeight: number
      readonly maxBytes: number
    }

const JPEG_QUALITIES = [80, 85, 70, 55, 40]

export const available = photonWasm !== ""

export async function load() {
  if (!available) throw new Error("photon wasm is unavailable")
  ;(globalThis as typeof globalThis & { __OPENCODE_PHOTON_WASM_PATH?: string }).__OPENCODE_PHOTON_WASM_PATH =
    path.isAbsolute(photonWasm) ? photonWasm : fileURLToPath(new URL(photonWasm, import.meta.url))
  return await import("@silvia-odwyer/photon-node")
}

export function normalize(photon: Photon, content: Content, limits: Readonly<Limits>): Result {
  let decoded: InstanceType<Photon["PhotonImage"]>
  try {
    decoded = photon.PhotonImage.new_from_byteslice(Buffer.from(content.content, "base64"))
  } catch {
    return { _tag: "DecodeError" }
  }
  try {
    const width = decoded.get_width()
    const height = decoded.get_height()
    const bytes = Buffer.byteLength(content.content, "utf-8")
    if (width <= limits.maxWidth && height <= limits.maxHeight && bytes <= limits.maxBase64Bytes)
      return { _tag: "Unchanged" }
    if (!limits.autoResize)
      return {
        _tag: "SizeError",
        width,
        height,
        bytes,
        maxWidth: limits.maxWidth,
        maxHeight: limits.maxHeight,
        maxBytes: limits.maxBase64Bytes,
      }
    const scale = Math.min(1, limits.maxWidth / width, limits.maxHeight / height)
    const sizes = Array.from({ length: 32 }).reduce<Array<{ width: number; height: number }>>((acc) => {
      const previous = acc.at(-1) ?? {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      }
      const next =
        acc.length === 0
          ? previous
          : {
              width: previous.width === 1 ? 1 : Math.max(1, Math.floor(previous.width * 0.75)),
              height: previous.height === 1 ? 1 : Math.max(1, Math.floor(previous.height * 0.75)),
            }
      return acc.some((item) => item.width === next.width && item.height === next.height) ? acc : [...acc, next]
    }, [])
    for (const size of sizes) {
      const resized = photon.resize(decoded, size.width, size.height, photon.SamplingFilter.Lanczos3)
      try {
        const encoders: Array<readonly [mime: string, encode: () => Uint8Array]> = [
          ["image/png", () => resized.get_bytes()],
          ...JPEG_QUALITIES.map((quality) => ["image/jpeg", () => resized.get_bytes_jpeg(quality)] as const),
        ]
        for (const [mime, encode] of encoders) {
          const candidate = encode()
          // Base64 uses four bytes per three input bytes, including padding.
          if (Math.ceil(candidate.length / 3) * 4 <= limits.maxBase64Bytes)
            return {
              _tag: "Content",
              content: {
                ...content,
                content: Buffer.from(candidate).toString("base64"),
                encoding: "base64" as const,
                mime,
              },
            }
        }
      } finally {
        resized.free()
      }
    }
    return {
      _tag: "SizeError",
      width,
      height,
      bytes,
      maxWidth: limits.maxWidth,
      maxHeight: limits.maxHeight,
      maxBytes: limits.maxBase64Bytes,
    }
  } finally {
    decoded.free()
  }
}
