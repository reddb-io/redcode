export * as SessionOutputGuard from "./output-guard.js"

import type { LLMEvent } from "@opencode/ai"

const WINDOW = 512
const HEADER = /(?:^|\n) {0,3}<tool_call>\s*([\w.:-]{1,128})\s*<arg_key>[^<>]{1,128}<\/arg_key>\s*<arg_value>$/

/** Detect GLM's raw call format in visible text. Native calls and reasoning remain provider-owned. */
export function make(names: readonly string[]) {
  const tools = new Set(names)
  let tail = ""
  let line = ""
  let fence: { marker: string; length: number } | undefined

  const reset = () => {
    tail = ""
    line = ""
    fence = undefined
  }
  const feed = (text: string) => {
    for (const character of text) {
      if (character === "\n" || character === "\r") {
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
        if (marker) {
          const closes =
            fence &&
            marker[0] === fence.marker &&
            marker.length >= fence.length &&
            /^\s{0,3}(?:`{3,}|~{3,})\s*$/.test(line)
          fence = closes ? undefined : (fence ?? { marker: marker[0], length: marker.length })
          tail = ""
        }
        if (fence) tail = ""
        if (!fence) tail = `${tail}\n`.slice(-WINDOW)
        line = ""
        continue
      }
      if (line.length < WINDOW) line += character
      if (fence || /^(?:\t| {4}| {0,3}[>`"'“‘]| {0,3}~{3})/u.test(line)) {
        tail = ""
        continue
      }
      tail = `${tail}${character}`.slice(-WINDOW)
      if (character !== ">") continue
      const tool = HEADER.exec(tail)?.[1]
      if (tool && tools.has(tool)) return tool
    }
  }

  const observe = (event: LLMEvent) => {
    if (!tools.size) return
    if (event.type === "text-start" || event.type === "tool-call") return reset()
    if (event.type === "text-delta") return feed(event.text)
    if (event.type === "text-end" && event.text) {
      reset()
      return feed(event.text)
    }
  }
  return { observe }
}

export function message(tool: string) {
  return `The provider emitted raw tool-call markup for '${tool}' as ordinary text. Generation stopped; this markup was not executed. Switch models or check the provider/router tool-call format before continuing.`
}
