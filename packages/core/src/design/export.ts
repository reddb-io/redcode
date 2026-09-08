export * as DesignExport from "./export"

import path from "node:path"
import { parseHTML } from "linkedom"
import { init, parse } from "es-module-lexer"
import { DesignFiles } from "./files"

/** HTML and CSS are web-format boundaries. Embed local bytes without executing the artifact. */
export async function html(root: string, entry: string) {
  await init
  const { document } = parseHTML(await Bun.file(await DesignFiles.resolve(root, entry)).text())
  const file = async (reference: string, parent: string) => {
    if (/^(?:[a-z]+:|\/\/)/i.test(reference)) throw new Error(`Export requires a local resource: ${reference}`)
    const relative = path.posix.join(
      reference.startsWith("/") ? "" : path.posix.dirname(parent),
      decodeURIComponent(reference.replace(/^\//, "").split(/[?#]/)[0]),
    )
    return { relative, file: Bun.file(await DesignFiles.resolve(root, relative)) }
  }
  const uri = async (reference: string, parent: string) => {
    if (/^(?:data:|#)/.test(reference)) return reference
    const asset = await file(reference, parent)
    return `data:${asset.file.type};base64,${Buffer.from(await asset.file.bytes()).toString("base64")}`
  }
  const css = async (source: string, parent: string, seen: string[] = []): Promise<string> => {
    if (seen.includes(parent)) throw new Error(`Circular CSS import: ${parent}`)
    const imports = [...source.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*([^;]*);/gi)]
    const expanded = await imports.reduce(async (pending, match) => {
      const asset = await file(match[1], parent)
      const nested = await css(await asset.file.text(), asset.relative, [...seen, parent])
      return (await pending).replace(match[0], match[2].trim() ? `@media ${match[2]}{${nested}}` : nested)
    }, Promise.resolve(source))
    return [...expanded.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].reduce(
      async (pending, match) => (await pending).replace(match[0], `url("${await uri(match[1].trim(), parent)}")`),
      Promise.resolve(expanded),
    )
  }
  for (const script of document.querySelectorAll("script[src]")) {
    const asset = await file(script.getAttribute("src")!, entry)
    const source = await asset.file.text()
    if (parse(source)[0].some((item) => item.d !== -2))
      throw new Error("Bundle JavaScript modules before exporting portable HTML")
    script.removeAttribute("src")
    script.textContent = source.replace(/<\/script/gi, "<\\/script")
  }
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const asset = await file(link.getAttribute("href")!, entry)
    const style = document.createElement("style")
    style.textContent = (await css(await asset.file.text(), asset.relative)).replace(/<\/style/gi, "<\\/style")
    link.replaceWith(style)
  }
  for (const style of document.querySelectorAll("style")) style.textContent = await css(style.textContent ?? "", entry)
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of ["src", "poster"]) {
      const value = element.getAttribute(attribute)
      if (value) element.setAttribute(attribute, await uri(value, entry))
    }
    if (element.hasAttribute("srcset")) {
      const value = element.getAttribute("srcset")!
      if (!value.startsWith("data:"))
        element.setAttribute(
          "srcset",
          (
            await Promise.all(
              value.split(",").map(async (candidate) => {
                const [reference, ...descriptor] = candidate.trim().split(/\s+/)
                return [await uri(reference, entry), ...descriptor].join(" ")
              }),
            )
          ).join(", "),
        )
    }
    if (element.hasAttribute("style")) element.setAttribute("style", await css(element.getAttribute("style")!, entry))
  }
  document.querySelectorAll('link[rel="modulepreload"],link[rel="preload"],base').forEach((element) => element.remove())
  return document.toString()
}
