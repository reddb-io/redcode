/**
 * Waiting on something outside the turn by sleeping in the shell.
 *
 * A model that has to wait for CI, a deploy or a server tends to write
 * `for i in $(seq 1 12); do sleep 300; gh run view …; done`. That holds the whole turn for up to an
 * hour with no output, nobody can steer it, and the bash timeout usually kills it anyway. A monitor
 * does the same observation in the background and resumes the session when the condition holds.
 *
 * This recognises the shape and rebuilds it as the equivalent monitor call, so the refusal can hand
 * a small model the exact retry instead of a lecture. It is text-based on purpose: it only has to
 * recognise a shape, and it never runs anything. Short sleeps and loops that observe nothing stay
 * allowed.
 */

import type { Monitor } from "@reddb-io/redcode-schema/monitor"

/** A sleep this long is a wait on something, not a pause between two steps. */
export const LONG_SLEEP_MS = 30_000
const DEFAULT_INTERVAL_MS = 30_000
const DEFAULT_DEADLINE_MS = 3_600_000
const MIN_INTERVAL_MS = 1_000
const MAX_INTERVAL_MS = 3_600_000
const MAX_DEADLINE_MS = 86_400_000

/** Commands that observe something outside this process: what a polling loop polls. */
const STATUS = new Set([
  "argocd",
  "aws",
  "az",
  "consul",
  "curl",
  "dig",
  "docker",
  "fly",
  "flyctl",
  "gcloud",
  "gh",
  "glab",
  "helm",
  "heroku",
  "http",
  "https",
  "kubectl",
  "nc",
  "netlify",
  "nomad",
  "oc",
  "pg_isready",
  "podman",
  "railway",
  "redis-cli",
  "systemctl",
  "vercel",
  "wget",
  "xh",
])

/** Words after which the next word is a command name. */
const LEADERS = new Set([
  "!",
  "command",
  "do",
  "elif",
  "else",
  "env",
  "exec",
  "if",
  "nohup",
  "sudo",
  "then",
  "time",
  "until",
  "while",
])

export interface Suggestion {
  readonly command: string
  readonly monitor: Monitor.Options
}

export interface Detection {
  readonly kind: "loop" | "sleep" | "watch"
  /** How long the command would have held the turn, when that can be read off it. */
  readonly waitMs?: number
  /** Commands ahead of the wait, which still have to run on their own. */
  readonly before?: string
  readonly suggestion?: Suggestion
}

type Token = { text: string; start: number; end: number }

/** Blank out single-quoted strings and comments: words inside them are not commands. */
function mask(text: string) {
  let out = ""
  let single = false
  let double = false
  let comment = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (comment) {
      comment = ch !== "\n"
      out += ch === "\n" ? ch : " "
      continue
    }
    if (single) {
      single = ch !== "'"
      out += ch === "'" || ch === "\n" ? ch : " "
      continue
    }
    if (ch === "\\" && i + 1 < text.length) {
      out += "  "
      i++
      continue
    }
    if (ch === '"') double = !double
    if (ch === "'" && !double) single = true
    if (ch === "#" && !double && (i === 0 || /\s/.test(text[i - 1]!))) {
      comment = true
      out += " "
      continue
    }
    out += ch
  }
  return out
}

function tokens(masked: string, from = 0, to = masked.length): Token[] {
  const out: Token[] = []
  const pattern = /[^\s;&|()`<>{}]+|[;&|()`{}\n]/g
  pattern.lastIndex = from
  for (let match = pattern.exec(masked); match && match.index < to; match = pattern.exec(masked)) {
    out.push({ text: match[0], start: match.index, end: match.index + match[0].length })
  }
  return out
}

function basename(word: string) {
  return word.slice(word.lastIndexOf("/") + 1).toLowerCase()
}

/** Tokens standing where a command name goes. */
function commandWords(masked: string, from = 0, to = masked.length) {
  const list = tokens(masked, from, to)
  return list.filter((token, index) => {
    if (/^[;&|()`{}\n]$/.test(token.text)) return false
    const previous = list[index - 1]
    if (!previous) return true
    if (/^[;&|(`{\n]$/.test(previous.text)) return true
    if (LEADERS.has(previous.text)) return true
    // `STATUS=value cmd`: an assignment prefix keeps the command position.
    return /^[A-Za-z_]\w*=/.test(previous.text) && !/^[A-Za-z_]\w*=/.test(token.text)
  })
}

function durationMs(args: string, powershell: boolean) {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return undefined
  if (powershell) {
    let unit = 1_000
    for (const word of words) {
      const flag = word.toLowerCase()
      if (flag === "-milliseconds" || flag === "-m") unit = 1
      else if (flag === "-seconds" || flag === "-s") unit = 1_000
      else if (/^\d+(\.\d+)?$/.test(word)) return Number(word) * unit
      else return undefined
    }
    return undefined
  }
  let total = 0
  for (const word of words) {
    if (word.toLowerCase() === "infinity") return Number.POSITIVE_INFINITY
    const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(word)
    if (!match) return undefined
    const scale = { "": 1_000, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "" | "s" | "m" | "h" | "d"]
    total += Number(match[1]) * scale
  }
  return total
}

type Sleep = { start: number; end: number; ms: number | undefined }

function sleeps(masked: string, from = 0, to = masked.length): Sleep[] {
  return commandWords(masked, from, to).flatMap((word) => {
    const name = basename(word.text)
    if (name !== "sleep" && name !== "start-sleep") return []
    const rest = /^[^;&|\n)`]*/.exec(masked.slice(word.end, to))![0]
    return [{ start: word.start, end: word.end + rest.length, ms: durationMs(rest, name === "start-sleep") }]
  })
}

/** The statement starting at `start`, pipes included, up to the next separator. */
function statement(text: string, masked: string, start: number) {
  let depth = 0
  let double = false
  let end = start
  for (; end < masked.length; end++) {
    const ch = masked[end]!
    if (ch === '"') double = !double
    if (double) continue
    if (ch === "(") depth++
    else if (ch === ")") {
      if (depth === 0) break
      depth--
    } else if (depth === 0) {
      if (ch === ";" || ch === "\n" || ch === "`") break
      if (ch === "&") break
      if (ch === "|" && masked[end + 1] === "|") break
    }
  }
  return text.slice(start, end).trim()
}

function clamp(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)))
}

/** A few status commands have a better polling form than whatever the loop wrapped around them. */
function canonical(command: string): { command: string; success?: string; failure?: string } | undefined {
  const words = command.split("|")[0]!.trim().split(/\s+/)
  const gh = words[0]
  if (!gh || basename(gh) !== "gh") return undefined
  const repo = (() => {
    const index = words.findIndex((word) => word === "-R" || word === "--repo")
    if (index >= 0 && words[index + 1]) return ` --repo ${words[index + 1]}`
    const inline = words.find((word) => word.startsWith("--repo="))
    return inline ? ` ${inline}` : ""
  })()
  const positional = (from: number) =>
    words
      .slice(from)
      .find((word, index, list) => !word.startsWith("-") && !["-R", "--repo", "-i", "--interval"].includes(list[index - 1] ?? ""))
  if (words[1] === "pr" && words[2] === "checks") {
    const target = positional(3)
    const required = words.includes("--required") ? " --required" : ""
    // Exit 0 once every check passed; pending exits non-zero, so polling continues.
    return { command: `${gh} pr checks${target ? ` ${target}` : ""}${repo}${required}`, failure: "fail" }
  }
  if (words[1] === "run" && (words[2] === "view" || words[2] === "watch")) {
    const target = positional(3)
    if (!target) return undefined
    // A run's status is only ever `completed` once it finished, whatever its conclusion.
    return { command: `${gh} run view ${target}${repo} --json status,conclusion`, success: "completed" }
  }
  return undefined
}

/** How many times a `for` header iterates, when it says so literally. */
function iterations(header: string) {
  const seq = /\$\(\s*seq\s+(\d+)(?:\s+(\d+))?(?:\s+(\d+))?\s*\)/.exec(header)
  if (seq) {
    const [a, b, c] = [seq[1], seq[2], seq[3]].map((value) => (value === undefined ? undefined : Number(value)))
    if (c !== undefined) return Math.floor((c - a!) / b!) + 1
    if (b !== undefined) return b - a! + 1
    return a
  }
  const brace = /\{(\d+)\.\.(\d+)\}/.exec(header)
  if (brace) return Math.abs(Number(brace[2]) - Number(brace[1])) + 1
  const cStyle = /\(\(\s*\w+\s*=\s*(\d+)\s*;\s*\w+\s*(<=?)\s*(\d+)/.exec(header)
  if (cStyle) return Number(cStyle[3]) - Number(cStyle[1]) + (cStyle[2] === "<=" ? 1 : 0)
  const list = /^\s*for\s+\w+\s+in\s+([^;\n]*?)\s*(?:;|\n|\bdo\b)/.exec(header)
  if (list && !/[$`*?[]/.test(list[1]!)) return list[1]!.split(/\s+/).filter(Boolean).length || undefined
  return undefined
}

/** The text a loop body waits to see before it breaks out. */
function breakCondition(masked: string) {
  const exit = masked.search(/(?<![\w-])break(?![\w-])/)
  if (exit < 0) return undefined
  const head = masked.slice(0, exit)
  const candidates = [
    ...head.matchAll(/(?:^|[\s(|])"?([\w./:-]+)"?(?:\|[\w./:-]+)*\)\s*$/gm),
    ...head.matchAll(/(?<![!<>])==?\s*"?([\w./:-]+)"?/g),
    ...head.matchAll(/\bgrep\s+(?:-\w*q\w*\s+)(?:-\w+\s+)*"?([\w./:-]+)"?/g),
  ]
  // Case arms look like `completed)`; the closest one before `break` is the one that breaks.
  const arms = [...head.matchAll(/(?:^|[\s(|;])"?([A-Za-z][\w./:-]*)"?\)/g)]
  const best = [...candidates, ...arms]
    .filter((match) => match[1] && !/^\$/.test(match[1]) && !/^\d+$/.test(match[1]))
    .toSorted((a, b) => (b.index ?? 0) - (a.index ?? 0))[0]
  return best?.[1]
}

function trimTail(text: string) {
  return text.replace(/[\s;&|]+$/, "").trim() || undefined
}

function build(input: {
  command: string
  intervalMs: number | undefined
  deadlineMs?: number
  success?: string
  failure?: string
}): Suggestion {
  const better = canonical(input.command)
  const interval = clamp(
    input.intervalMs && Number.isFinite(input.intervalMs) ? input.intervalMs : DEFAULT_INTERVAL_MS,
    MIN_INTERVAL_MS,
    MAX_INTERVAL_MS,
  )
  const deadline = clamp(input.deadlineMs ?? DEFAULT_DEADLINE_MS, interval, MAX_DEADLINE_MS)
  const success = better ? better.success : input.success
  const failure = better ? better.failure : input.failure
  return {
    command: better?.command ?? input.command,
    monitor: {
      mode: "poll",
      interval_ms: interval,
      deadline_ms: deadline,
      ...(success ? { success_contains: success } : {}),
      ...(failure ? { failure_contains: failure } : {}),
    },
  }
}

function loops(masked: string) {
  const out: { start: number; end: number; keyword: string; doAt: number }[] = []
  for (const word of commandWords(masked)) {
    if (!["for", "while", "until"].includes(word.text)) continue
    const marks = /(?<![\w.\/-])(do|done)(?![\w.\/-])/g
    marks.lastIndex = word.end
    let depth = 0
    let doAt = -1
    let end = masked.length
    for (let match = marks.exec(masked); match; match = marks.exec(masked)) {
      if (match[1] === "do") {
        if (doAt < 0) doAt = match.index
        depth++
        continue
      }
      depth--
      if (depth === 0) {
        end = match.index + match[0].length
        break
      }
    }
    if (doAt < 0) continue
    out.push({ start: word.start, end, keyword: word.text, doAt })
  }
  return out
}

function detectLoop(command: string, masked: string): Detection | undefined {
  for (const loop of loops(masked)) {
    const naps = sleeps(masked, loop.start, loop.end)
    if (naps.length === 0) continue
    const status = commandWords(masked, loop.start, loop.end).find((word) => STATUS.has(basename(word.text)))
    if (!status) continue
    const inHeader = status.start < loop.doAt
    const negated = inHeader && /!\s*$/.test(masked.slice(loop.start, status.start))
    const text = statement(command, masked, status.start)
    const interval = naps[0]!.ms
    const count = loop.keyword === "for" ? iterations(command.slice(loop.start, loop.doAt + 2)) : undefined
    const waitMs = count !== undefined && interval !== undefined ? count * interval : undefined
    const success =
      inHeader && (loop.keyword === "until" || negated)
        ? undefined
        : breakCondition(masked.slice(loop.doAt, loop.end))
    return {
      kind: "loop",
      ...(waitMs !== undefined && Number.isFinite(waitMs) ? { waitMs } : {}),
      ...(trimTail(command.slice(0, loop.start)) ? { before: trimTail(command.slice(0, loop.start)) } : {}),
      suggestion: build({
        command: text,
        intervalMs: interval,
        ...(waitMs !== undefined ? { deadlineMs: waitMs + (interval ?? 0) } : {}),
        ...(success ? { success } : {}),
      }),
    }
  }
  return undefined
}

function detectWatch(command: string, masked: string): Detection | undefined {
  for (const word of commandWords(masked)) {
    const name = basename(word.text)
    if (name === "watch") {
      const rest = statement(command, masked, word.end)
      const parts = rest.split(/\s+/)
      let interval = 2_000
      let index = 0
      while (parts[index]?.startsWith("-")) {
        const flag = parts[index]!
        if (flag === "-n" || flag === "--interval") {
          interval = Number(parts[index + 1]) * 1_000 || interval
          index += 2
          continue
        }
        const inline = /^(?:-n|--interval=)(\d+(?:\.\d+)?)$/.exec(flag)
        if (inline) interval = Number(inline[1]) * 1_000
        index++
      }
      const observed = parts.slice(index).join(" ").replace(/^["']|["']$/g, "")
      if (!observed) continue
      return {
        kind: "watch",
        ...(trimTail(command.slice(0, word.start)) ? { before: trimTail(command.slice(0, word.start)) } : {}),
        suggestion: build({ command: observed, intervalMs: interval }),
      }
    }
    if (name !== "gh") continue
    const text = statement(command, masked, word.start)
    const words = text.split(/\s+/)
    const blocking =
      (words[1] === "run" && words[2] === "watch") || (words[1] === "pr" && words[2] === "checks" && words.includes("--watch"))
    if (!blocking) continue
    const interval = (() => {
      const index = words.findIndex((item) => item === "-i" || item === "--interval")
      return index >= 0 ? Number(words[index + 1]) * 1_000 || undefined : undefined
    })()
    return {
      kind: "watch",
      ...(trimTail(command.slice(0, word.start)) ? { before: trimTail(command.slice(0, word.start)) } : {}),
      suggestion: build({ command: text, intervalMs: interval ?? DEFAULT_INTERVAL_MS }),
    }
  }
  return undefined
}

function detectSleep(command: string, masked: string): Detection | undefined {
  const long = sleeps(masked).find((nap) => nap.ms === undefined || nap.ms >= LONG_SLEEP_MS)
  // An unreadable duration (`sleep "$DELAY"`) is only refused inside a polling loop, above.
  if (!long || long.ms === undefined) return undefined
  const status = commandWords(masked, long.end).find((word) => STATUS.has(basename(word.text)))
  const before = trimTail(command.slice(0, long.start))
  return {
    kind: "sleep",
    ...(Number.isFinite(long.ms) ? { waitMs: long.ms } : {}),
    ...(before ? { before } : {}),
    ...(status ? { suggestion: build({ command: statement(command, masked, status.start), intervalMs: long.ms }) } : {}),
  }
}

export function detect(command: string): Detection | undefined {
  const masked = mask(command)
  return detectLoop(command, masked) ?? detectWatch(command, masked) ?? detectSleep(command, masked)
}

function duration(ms: number) {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`
  return `${Math.round(ms / 1_000)}s`
}

export const EXAMPLES = [
  {
    command: "gh pr checks 123",
    monitor: { mode: "poll", interval_ms: 60_000, deadline_ms: 3_600_000, failure_contains: "fail" },
  },
  {
    command: "gh run view 456789 --json status,conclusion",
    monitor: { mode: "poll", interval_ms: 60_000, deadline_ms: 3_600_000, success_contains: "completed" },
  },
] satisfies Suggestion[]

/** The call a model should make instead, as the JSON it would send. */
export function call(suggestion: Suggestion, workdir?: string) {
  return JSON.stringify({ command: suggestion.command, ...(workdir ? { workdir } : {}), monitor: suggestion.monitor })
}

export function refusal(detection: Detection, workdir?: string) {
  const held = detection.waitMs !== undefined ? ` for up to ${duration(detection.waitMs)}` : ""
  const lines = [
    detection.kind === "loop"
      ? `Not run: this command waits by sleeping in a polling loop, which would block the turn${held}.`
      : detection.kind === "watch"
        ? "Not run: this command watches a job until it ends, which blocks the turn for as long as the job runs."
        : `Not run: this command sleeps${held}, which blocks the turn. Sleeps shorter than ${duration(LONG_SLEEP_MS)} are allowed.`,
    "Wait with a bash monitor instead. It runs the status command in the background every interval_ms, releases the turn, and resumes this session with the result once the condition is met: exit code 0 (and success_contains, if set, is in the output), failure_contains is in the output, or deadline_ms passes.",
  ]
  if (detection.before)
    lines.push(`Run the part before the wait first, as its own bash call without any sleep: ${detection.before}`)
  if (detection.suggestion) {
    lines.push("Retry with this bash call:", call(detection.suggestion, workdir))
    if (!detection.suggestion.monitor.success_contains && !detection.suggestion.monitor.failure_contains)
      lines.push(
        "Here exit code 0 means done. If done is shown by text in the output instead, add monitor.success_contains with that text.",
      )
  } else {
    lines.push(
      "Examples:",
      ...EXAMPLES.map((example) => call(example, workdir)),
      'For a long command of your own (a build, a deploy script), call bash with monitor {"mode":"once"} instead.',
    )
  }
  lines.push(
    "After starting the monitor, end your response or do independent work. Do not sleep, do not call monitor wait repeatedly, and do not start the same monitor twice.",
  )
  return lines.join("\n")
}

export * as ShellPolling from "./polling"
