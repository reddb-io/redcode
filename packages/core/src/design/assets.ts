export * as DesignAssets from "./assets"

import { DOMParser } from "linkedom"
import { Design } from "@reddb-io/redcode-schema/design"

export function validate(data: string, mime: Design.ImportAsset["mime"]) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
    throw new Design.Error({ code: "invalid", message: "Asset data must be canonical base64" })
  const bytes = Buffer.from(data, "base64")
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new Design.Error({ code: "invalid", message: "Assets must contain at most 10 MB" })
  const valid =
    mime === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : mime === "image/webp"
          ? bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
          : mime === "image/gif"
            ? /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))
            : svg(bytes.toString("utf8"))
  if (!valid) throw new Design.Error({ code: "invalid", message: "Asset content does not match its media type" })
  return bytes
}

export function svg(source: string) {
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(source.replace(/^\s*<\?xml[^?]*\?>/, "")))
    throw new Design.Error({ code: "invalid", message: "SVG entities and processing instructions are unsupported" })
  const document = new DOMParser().parseFromString(source, "image/svg+xml")
  if (document.documentElement?.localName !== "svg") return false
  const forbidden = new Set(["script", "foreignobject", "iframe", "object", "embed", "audio", "video"])
  for (const element of document.querySelectorAll("*")) {
    if (forbidden.has(element.localName.toLowerCase()))
      throw new Design.Error({
        code: "invalid",
        message: "SVG assets support CSS and SMIL without embedded executable content",
      })
    for (const attribute of element.attributes) {
      if (
        /^on/i.test(attribute.name) ||
        /javascript\s*:/i.test(attribute.value) ||
        (/^(?:href|xlink:href|src)$/i.test(attribute.name) && !attribute.value.startsWith("#")) ||
        (/^attributeName$/i.test(attribute.name) && /^(?:href|xlink:href|src|on)/i.test(attribute.value))
      )
        throw new Design.Error({
          code: "invalid",
          message: "SVG assets cannot load external resources or execute scripts",
        })
    }
  }
  if (
    /@import/i.test(source) ||
    [...source.matchAll(/url\(\s*([^)]+)\)/gi)].some(
      (match) =>
        !match[1]
          .trim()
          .replace(/^["']|["']$/g, "")
          .startsWith("#"),
    )
  )
    throw new Design.Error({ code: "invalid", message: "SVG CSS resources must use local fragment references" })
  return true
}
