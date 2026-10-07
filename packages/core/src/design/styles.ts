export * as DesignStyles from "./styles.js"

import { Parser } from "htmlparser2"

/** Static CSS declarations with source offsets. Strings, comments and functions are never delimiters. */
export function parse(text: string, offset = 0) {
  const clean = text.split("")
  const entries: { property: string; value: string; offset: number }[] = []
  const comments: { text: string; offset: number }[] = []
  let start = 0
  let quote = ""
  let depth = 0
  for (let index = 0; index < clean.length; index++) {
    const char = clean[index]!
    if (char === "\\") {
      index++
      continue
    }
    if (quote) {
      if (char === quote) quote = ""
      continue
    }
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2)
      comments.push({ text: text.slice(index + 2, end === -1 ? text.length : end), offset: offset + index })
      const until = end === -1 ? text.length : end + 2
      for (let cursor = index; cursor < until; cursor++)
        if (clean[cursor] !== "\r" && clean[cursor] !== "\n") clean[cursor] = " "
      index = until - 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === "(" || char === "[") depth++
    if (char === ")" || char === "]") depth = Math.max(0, depth - 1)
    if (depth || !["{", "}", ";"].includes(char)) continue
    if (char !== "{") {
      const match = /^\s*(--[\w-]+|[a-zA-Z-]+)\s*:\s*([\s\S]*?)\s*$/.exec(clean.slice(start, index).join(""))
      if (match) entries.push({ property: match[1]!, value: match[2]!, offset: offset + start + match[0].search(/\S/) })
    }
    start = index + 1
  }
  // An incomplete trailing declaration contributes no evidence (discovery excerpts may end mid-value).
  return { entries, comments }
}

export const declarations = (text: string) => parse(text).entries

/** CSS files and actual HTML style elements only; scripts, attributes and JSX expressions are left to other checks. */
export function blocks(file: string, text: string) {
  if (file.endsWith(".css")) return [{ text, offset: 0 }]
  if (!/\.(?:html|vue|svelte)$/.test(file)) return []
  const entries: { text: string; offset: number }[] = []
  let style = false
  const parser = new Parser(
    {
      onopentag: (name) => {
        if (name === "style") style = true
      },
      onclosetag: (name) => {
        if (name === "style") style = false
      },
      ontext: (value) => {
        if (style) entries.push({ text: value, offset: parser.startIndex })
      },
    },
    { decodeEntities: false },
  )
  parser.end(text)
  return entries
}

/** Build line offsets once; repeated findings do not rescan the entire source prefix. */
export function positions(text: string) {
  const starts = [0, ...[...text.matchAll(/\n/g)].map((match) => match.index + 1)]
  return (offset: number) => {
    let low = 0
    let high = starts.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (starts[middle]! <= offset) low = middle + 1
      if (starts[middle]! > offset) high = middle
    }
    return low
  }
}
