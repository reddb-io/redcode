export * as ReasoningObserver from "./reasoning-observer.js"

import type { LLMEvent } from "@opencode/ai"

export const VERSION = "1"
export const LIMITS = {
  line: 512,
  prefix: 32,
  segments: 30,
  consecutive: 12,
  cycle: 24,
  cyclePeriod: 8,
  periodic: 192,
  periodicPeriod: 24,
  periodicStride: 24,
} as const

export type Observation = {
  readonly version: typeof VERSION
  readonly kind: "consecutive" | "cycle" | "periodic"
  readonly characters: number
  readonly segments: number
  readonly period: number
  readonly repeats: number
}

/** Observes syntax only. It neither classifies semantic usefulness nor owns stream policy. */
export function make() {
  let observation: Observation | undefined
  let finished = false
  let characters = 0
  let segments = 0
  let periodicChecks = 0
  let maxLine = 0
  let maxPrefix = 0
  let maxSegments = 0
  let maxPeriodic = 0
  let line = ""
  let prefix = ""
  let truncated = false
  let excluded = false
  let fence: { marker: string; length: number } | undefined
  let previousCR = false
  let sawDeltas = false
  const recent: Array<{ hash: number; length: number }> = []
  const tail = new Uint16Array(LIMITS.periodic)
  let tailPosition = 0
  let tailLength = 0
  let tailCharacters = 0

  const clearTail = () => {
    tailPosition = 0
    tailLength = 0
    tailCharacters = 0
  }
  const clearLine = () => {
    line = ""
    prefix = ""
    truncated = false
    excluded = false
    clearTail()
  }
  const progress = () => {
    recent.length = 0
    clearLine()
    previousCR = false
  }
  const resetBlock = () => {
    progress()
    fence = undefined
    sawDeltas = false
  }
  const capture = (kind: Observation["kind"], period: number, repeats: number) => {
    observation ??= { version: VERSION, kind, characters, segments, period, repeats }
  }
  const completeLine = () => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      const closes =
        fence && marker[0] === fence.marker && marker.length >= fence.length && /^\s{0,3}(?:`{3,}|~{3,})\s*$/.test(line)
      fence = closes ? undefined : (fence ?? { marker: marker[0], length: marker.length })
      recent.length = 0
      clearLine()
      return
    }
    // Long lines are never truncated into a fingerprint; only the fixed periodic window sees them.
    const normalized = line.trim().replace(/\s+/g, " ").toLowerCase()
    if (
      fence ||
      excludedPrefix(prefix) ||
      truncated ||
      normalized.length < 16 ||
      /^[\s─━\-=_*#|+]+$/u.test(normalized)
    ) {
      recent.length = 0
      clearLine()
      return
    }
    const fingerprint = { hash: fingerprintLine(normalized), length: normalized.length }
    if (recent.length === LIMITS.segments) recent.shift()
    recent.push(fingerprint)
    segments++
    maxSegments = Math.max(maxSegments, recent.length)
    if (!observation && recent.length >= LIMITS.consecutive) {
      const window = recent.slice(-LIMITS.consecutive)
      if (window.every((entry) => same(entry, fingerprint))) capture("consecutive", 1, LIMITS.consecutive)
    }
    if (!observation && recent.length >= LIMITS.cycle) {
      const window = recent.slice(-LIMITS.cycle)
      for (let period = 2; period <= LIMITS.cyclePeriod; period++) {
        if (
          window.some((entry) => !same(entry, window[0])) &&
          window.every((entry, index) => index < period || same(entry, window[index - period]))
        ) {
          capture("cycle", period, Math.floor(LIMITS.cycle / period))
          break
        }
      }
    }
    clearLine()
  }
  const scanPeriodic = () => {
    if (observation || tailLength < LIMITS.periodic || tailCharacters % LIMITS.periodicStride !== 0) return
    periodicChecks++
    if (tail.every((character) => character === tail[0])) return
    const window = Array.from({ length: LIMITS.periodic }, (_, index) =>
      String.fromCharCode(tail[(tailPosition + index) % LIMITS.periodic]),
    ).join("")
    // Separator lines and repeated single letters provide no textual repetition evidence.
    if (!/\p{L}{3}/u.test(window) || new Set(window.toLowerCase().match(/\p{L}/gu)).size < 2) return
    for (let period = 4; period <= LIMITS.periodicPeriod; period++) {
      const matches = tail.every(
        (_, index) =>
          index < period ||
          tail[(tailPosition + index) % LIMITS.periodic] === tail[(tailPosition + index - period) % LIMITS.periodic],
      )
      if (matches) {
        capture("periodic", period, Math.floor(LIMITS.periodic / period))
        return
      }
    }
  }
  const feed = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      characters++
      const character = text[index]
      if (previousCR && character === "\n") {
        previousCR = false
        continue
      }
      previousCR = character === "\r"
      if (character === "\r" || character === "\n") {
        completeLine()
        continue
      }
      if (line.length < LIMITS.line) line += character
      else truncated = true
      maxLine = Math.max(maxLine, line.length)
      if (prefix.length < LIMITS.prefix) {
        prefix += character
        maxPrefix = Math.max(maxPrefix, prefix.length)
        if (prefix.length === LIMITS.prefix) excluded = excludedPrefix(prefix)
      }
      if (fence || excluded || prefix.length < LIMITS.prefix) continue
      tail[tailPosition] = character.charCodeAt(0)
      tailPosition = (tailPosition + 1) % LIMITS.periodic
      tailLength = Math.min(tailLength + 1, LIMITS.periodic)
      tailCharacters++
      maxPeriodic = Math.max(maxPeriodic, tailLength)
      scanPeriodic()
    }
  }
  const observe = (event: LLMEvent) => {
    if (finished) return
    switch (event.type) {
      case "reasoning-start":
        resetBlock()
        return
      case "reasoning-delta":
        sawDeltas ||= event.text.length > 0
        feed(event.text)
        return
      case "reasoning-end":
        // A complete end value may replace deltas. Never count the same streamed text twice.
        if (!sawDeltas && event.text) feed(event.text)
        if (line || truncated) completeLine()
        resetBlock()
        return
      case "text-delta":
        if (event.text) progress()
        return
      case "text-end":
        if (event.text) progress()
        return
      case "tool-input-start":
      case "tool-input-delta":
      case "tool-input-end":
      case "tool-call":
      case "tool-result":
      case "tool-error":
        progress()
    }
  }
  const snapshot = () => ({
    observation,
    characters,
    segments,
    periodicChecks,
    lineCodeUnits: line.length,
    prefixCodeUnits: prefix.length,
    recentSegments: recent.length,
    periodicCodeUnits: tailLength,
    maxLineCodeUnits: maxLine,
    maxPrefixCodeUnits: maxPrefix,
    maxRecentSegments: maxSegments,
    maxPeriodicCodeUnits: maxPeriodic,
  })
  const finish = () => {
    if (!finished && (line || truncated)) completeLine()
    finished = true
    progress()
    return snapshot()
  }
  return { observe, progress, finish, snapshot }
}

function excludedPrefix(prefix: string) {
  return (
    /^(?:\t| {4})/.test(prefix) ||
    /^\s{0,3}[>"'“‘`]/u.test(prefix) ||
    /^\s{0,3}~{3}/.test(prefix) ||
    /^\s*(?:\[(?:trace|debug|info|warn|error|fatal)\]|(?:trace|debug|info|warn|error|fatal)\b|\d{4}-\d{2}-\d{2}[T ]|\d{2}:\d{2}:\d{2}\b)/i.test(
      prefix,
    )
  )
}

function fingerprintLine(text: string) {
  let hash = 2_166_136_261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619)
  return hash >>> 0
}

function same(left: { hash: number; length: number }, right: { hash: number; length: number }) {
  return left.hash === right.hash && left.length === right.length
}
