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
 * recognise a shape, and it never runs anything. Short sleeps, short or bounded retry loops, and
 * batch loops that act on each item stay allowed.
 */

import type { Monitor } from "@reddb-io/redcode-schema/monitor"

/** A wait this long is a wait on something, not a pause between two steps. */
export const LONG_SLEEP_MS = 30_000
const DEFAULT_INTERVAL_MS = 30_000
const DEFAULT_DEADLINE_MS = 3_600_000
/** A local readiness wait (`until pg_isready; do sleep 1; done`) is polled briskly and given up on soon. */
const READINESS_DEADLINE_MS = 120_000
const READINESS_SLEEP_MS = 5_000
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
  "timeout",
  "until",
  "while",
])

const SHELLS = new Set(["bash", "dash", "ksh", "sh", "zsh"])
const SEPARATOR = /^[;&|(`{\n]$/

export interface Suggestion {
  readonly command: string
  readonly monitor: Monitor.Options
}

export interface Detection {
  readonly kind: "loop" | "sleep" | "watch"
  /** How long the command would have held the turn, when that can be read off it. */
  readonly waitMs?: number
  /** Commands ahead of the wait, which still have to run on their own first. */
  readonly before?: string
  /** Commands after the wait, which the model has to run once the monitor reports. */
  readonly after?: string
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

const DURATION = /^\d+(\.\d+)?[smhd]?$/

/** Tokens standing where a command name goes. */
function commandWords(masked: string, from = 0, to = masked.length) {
  const list = tokens(masked, from, to)
  return list.filter((token, index) => {
    if (SEPARATOR.test(token.text) || token.text === ")") return false
    const previous = list[index - 1]
    if (!previous) return true
    if (SEPARATOR.test(previous.text)) return true
    if (LEADERS.has(previous.text)) return true
    // `timeout 10m cmd`, `timeout -k 5 60 cmd`: the command follows timeout's own arguments.
    for (let j = index - 1; j >= 0; j--) {
      const text = list[j]!.text
      if (text === "timeout") return j < index - 1
      if (!text.startsWith("-") && !DURATION.test(text)) break
    }
    // `STATUS=value cmd`: an assignment prefix keeps the command position.
    return /^[A-Za-z_]\w*=/.test(previous.text) && !/^[A-Za-z_]\w*=/.test(token.text)
  })
}

/** Where the simple command holding the text at `at` starts: just after the separator before it. */
function statementStart(masked: string, at: number) {
  const list = tokens(masked, 0, at)
  for (let i = list.length - 1; i >= 0; i--) {
    const text = list[i]!.text
    if (SEPARATOR.test(text) || ["do", "then", "else", "elif"].includes(text)) return list[i]!.end
  }
  return 0
}

/** The duration a `timeout` in front of the command at `at` allows it, if any. */
function leaderTimeout(masked: string, at: number) {
  const lead = tokens(masked, statementStart(masked, at), at).map((token) => token.text)
  const index = lead.indexOf("timeout")
  if (index < 0) return undefined
  const limit = lead.slice(index + 1).find((text) => DURATION.test(text))
  return limit === undefined ? undefined : durationMs(limit, false)
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
    const rest = /^[^;&|\n)`]*/.exec(masked.slice(word.end, to))![0]
    const end = word.end + rest.length
    if (name === "sleep" || name === "start-sleep")
      return [{ start: word.start, end, ms: durationMs(rest, name === "start-sleep") }]
    // cmd.exe: `timeout /t 60` waits sixty seconds.
    const pause = name === "timeout" ? /^\s*\/t\s+(\d+)/i.exec(rest) : null
    return pause ? [{ start: word.start, end, ms: Number(pause[1]) * 1_000 }] : []
  })
}

/** Where the statement starting at `start` ends: pipes included, up to the next separator. */
function statementEnd(masked: string, start: number) {
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
      if (ch === ";" || ch === "\n" || ch === "`" || ch === "&") break
      if (ch === "|" && masked[end + 1] === "|") break
    }
  }
  return end
}

function statement(text: string, masked: string, start: number) {
  return text.slice(start, statementEnd(masked, start)).trim()
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
      .find(
        (word, index, list) =>
          !word.startsWith("-") && !["-R", "--repo", "-i", "--interval"].includes(list[index - 1] ?? ""),
      )
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
  const list = /^\s*for\s+\w+\s+in\s+([^;\n]*?)\s*(?:;|\n|\bdo\b|$)/.exec(header)
  if (!list || /[$`*?[]/.test(list[1]!)) return undefined
  const items = list[1]!.split(/\s+/).filter(Boolean)
  // `for i in 1..12` is not a bash range, but it is plainly what the model meant.
  const range = items.length === 1 ? /^(\d+)\.\.(\d+)$/.exec(items[0]!) : null
  if (range) return Math.abs(Number(range[2]) - Number(range[1])) + 1
  return items.length || undefined
}

/** The text a loop body waits to see before it breaks out. */
function breakCondition(masked: string) {
  const exit = masked.search(/(?<![\w-])break(?![\w-])/)
  if (exit < 0) return undefined
  const head = masked.slice(0, exit)
  const candidates = [
    ...head.matchAll(/(?<![!<>])==?\s*"?([\w./:-]+)"?/g),
    ...head.matchAll(/\bgrep\s+(?:-\w*q\w*\s+)(?:-\w+\s+)*"?([\w./:-]+)"?/g),
    // Case arms look like `completed)`.
    ...head.matchAll(/(?:^|[\s(|;])"?([A-Za-z][\w./:-]*)"?\)/g),
  ]
  // The closest candidate before `break` is the one that breaks.
  const best = candidates
    .filter((match) => match[1] && !/^\$/.test(match[1]) && !/^\d+$/.test(match[1]))
    .toSorted((a, b) => (b.index ?? 0) - (a.index ?? 0))[0]
  return best?.[1]
}

/** The commands ahead of a wait, without the separator joining them to it. A trailing `&` stays: it backgrounds the command. */
function trimTail(text: string) {
  let out = text.trim()
  while (true) {
    const next = out.replace(/(?:;|&&|\|\||\|)\s*$/, "").trim()
    if (next === out) break
    out = next
  }
  return out || undefined
}

/** The commands after a wait, without the separator joining them to it. */
function trimHead(text: string) {
  let out = text.trim()
  while (true) {
    const next = out.replace(/^(?:;|&&|\|\||\||&)\s*/, "").trim()
    if (next === out) break
    out = next
  }
  return out || undefined
}

function before(command: string, masked: string, at: number) {
  return trimTail(command.slice(0, statementStart(masked, at)))
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

function compact(detection: Detection): Detection {
  return Object.fromEntries(Object.entries(detection).filter(([, value]) => value !== undefined)) as Detection
}

/** A `timeout` in front bounds the wait: short enough, it is a step; otherwise it caps the deadline. */
function bound(detection: Detection | undefined, limit: number | undefined): Detection | undefined {
  if (!detection || limit === undefined) return detection
  if (limit < LONG_SLEEP_MS) return undefined
  const suggestion =
    detection.suggestion?.monitor.mode === "poll"
      ? {
          ...detection.suggestion,
          monitor: {
            ...detection.suggestion.monitor,
            deadline_ms: clamp(
              Math.min(detection.suggestion.monitor.deadline_ms ?? DEFAULT_DEADLINE_MS, limit),
              detection.suggestion.monitor.interval_ms ?? MIN_INTERVAL_MS,
              MAX_DEADLINE_MS,
            ),
          },
        }
      : detection.suggestion
  return compact({ ...detection, waitMs: Math.min(detection.waitMs ?? limit, limit), suggestion })
}

type Loop = { start: number; end: number; keyword: string; doAt: number }

function loops(masked: string) {
  const out: Loop[] = []
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

/**
 * A batch loop acts on each item (`for c in $(docker ps -q); do docker stop $c; sleep 1; done`,
 * `while read repo; do gh api repos/$repo; done < list`). Polling repeats the same check against a
 * fixed target, so a status command that uses the loop variable is not waiting on anything.
 */
function batch(header: string, status: string) {
  if (/^\s*while\s+(?:IFS=\S*\s+)?read\b/.test(header)) return true
  const variable = /^\s*for\s+(?:\(\(\s*)?(\w+)/.exec(header)?.[1]
  return variable !== undefined && new RegExp(`\\$\\{?${variable}\\b`).test(status)
}

/** A header that is always true: the loop only ends through `break`. */
const FOREVER = /^(?:true|:|\[\s*1\s*\]|\(\(\s*1\s*\)\))$/

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function uses(text: string, variable: string) {
  return new RegExp(`\\$\\{?${escape(variable)}\\b`).test(text)
}

/** A literal test of a shell counter: `[ $n -ge 10 ]`, `[[ "$i" -lt 30 ]]`, `(( i < 30 ))`. */
function counterTest(variable: string) {
  const name = escape(variable)
  return `(?:\\[\\[?\\s*"?\\$\\{?${name}\\}?"?\\s+-(?:lt|le|gt|ge|eq|ne)\\s+"?\\d+"?\\s*\\]\\]?|\\(\\(\\s*\\$?${name}\\s*(?:<=|<|>=|>|==|!=)\\s*\\d+\\s*\\)\\))`
}

/**
 * How many rounds a counter bounds the loop to (`n=0; until … || [ $n -ge 20 ]; do …; n=$((n+1)); done`),
 * when it is incremented in the body and compared with a literal.
 */
function counted(command: string, loop: Loop): { variable: string; count: number } | undefined {
  const body = command.slice(loop.doAt, loop.end)
  const whole = command.slice(loop.start, loop.end)
  const increments = body.matchAll(
    /\b(\w+)=\$\(\(\s*\$?(\w+)\s*\+\s*1\s*\)\)|\(\(\s*(?:(\w+)\s*(?:\+\+|\+=\s*1)|\+\+(\w+))\s*\)\)|\blet\s+["']?(\w+)(?:\+\+|\s*\+=\s*1)/g,
  )
  for (const match of increments) {
    const variable =
      match[1] !== undefined ? (match[1] === match[2] ? match[1] : undefined) : (match[3] ?? match[4] ?? match[5])
    if (!variable) continue
    const name = escape(variable)
    const test =
      new RegExp(`\\$\\{?${name}\\}?"?\\s+-(lt|le|gt|ge|eq)\\s+"?(\\d+)`).exec(whole) ??
      new RegExp(`\\(\\(\\s*\\$?${name}\\s*(<=|<|>=|>|==)\\s*(\\d+)`).exec(whole)
    if (!test) continue
    const init = [...command.slice(0, loop.start).matchAll(new RegExp(`(?:^|[\\s;&(])${name}=(\\d+)`, "g"))].at(-1)
    const inclusive = ["le", "gt", "<=", ">"].includes(test[1]!)
    return { variable, count: Math.max(Number(test[2]) - Number(init?.[1] ?? 0), 0) + (inclusive ? 1 : 0) }
  }
  return undefined
}

/** The `while`/`until` condition without its counter bound, which a monitor's deadline replaces. */
function condition(command: string, loop: Loop, counter: string | undefined) {
  let text = trimTail(command.slice(loop.start + loop.keyword.length, loop.doAt)) ?? ""
  if (counter) {
    const test = counterTest(counter)
    text = text
      .replace(new RegExp(`\\s*(?:\\|\\||&&)\\s*${test}`), "")
      .replace(new RegExp(`^${test}\\s*(?:\\|\\||&&)\\s*`), "")
      .replace(new RegExp(`^${test}$`), "")
      .trim()
  }
  return text && !FOREVER.test(text) ? text : undefined
}

/** The check that succeeds once a `while` loop would stop: its condition, inverted. */
function negate(text: string) {
  if (/&&|\|\||;/.test(text)) return `! { ${text}; }`
  const bang = /^!\s+(.+)$/.exec(text)
  if (bang) return bang[1]!
  const bracket = /^(\[\[?)\s+!\s+([^\]]+?)\s*(\]\]?)$/.exec(text)
  if (bracket) return `${bracket[1]} ${bracket[2]} ${bracket[3]}`
  if (/^test\s+!\s+/.test(text)) return text.replace(/^test\s+!\s+/, "test ")
  return `! ${text}`
}

/**
 * The command a loop body breaks on (`grep -q PASSED ci.log && break`, `if [ -f ready ]; then break; fi`).
 * Counter tests and checks on variables the body sets are skipped: a monitor cannot repeat them alone.
 */
function breakCheck(command: string, masked: string, loop: Loop, counter: string | undefined) {
  const from = loop.doAt + 2
  const body = masked.slice(from, loop.end)
  const found: string[] = []
  for (const match of body.matchAll(/&&\s*break(?![\w-])/g)) {
    const at = from + match.index
    const head = masked.slice(from, at)
    const start = from + Math.max(head.lastIndexOf(";"), head.lastIndexOf("\n")) + 1
    found.push(
      command
        .slice(start, at)
        .trim()
        .replace(/^(?:(?:do|then|else|\{)\s+)+/, ""),
    )
  }
  for (const match of body.matchAll(/(?<![\w-])(?:if|elif)\s+([^;\n]+?)\s*[;\n]\s*then\s+break(?![\w-])/g)) {
    const condition = match[1] ?? ""
    const start = from + match.index + match[0].indexOf(condition)
    found.push(command.slice(start, start + condition.length).trim())
  }
  const assigned = [...command.slice(loop.doAt, loop.end).matchAll(/(?:^|[\s;&(])([A-Za-z_]\w*)=/g)].map(
    (match) => match[1] ?? "",
  )
  return found.find(
    (check) => check && !(counter && uses(check, counter)) && !assigned.some((variable) => uses(check, variable)),
  )
}

function detectLoop(command: string, masked: string): Detection | undefined {
  for (const loop of loops(masked)) {
    const naps = sleeps(masked, loop.start, loop.end)
    if (naps.length === 0) continue
    const header = command.slice(loop.start, loop.doAt)
    if (/^\s*while\s+(?:IFS=\S*\s+)?read\b/.test(header)) continue
    const interval = naps.every((nap) => nap.ms !== undefined)
      ? naps.reduce((total, nap) => total + nap.ms!, 0)
      : undefined
    const counter = counted(command, loop)
    const count = loop.keyword === "for" ? iterations(`${header}do`) : counter?.count
    const waitMs = count !== undefined && interval !== undefined ? count * interval : undefined
    // A short retry (`for i in 1 2 3; do curl … && break; sleep 2; done`) is a step, not a wait.
    if (waitMs !== undefined && waitMs < LONG_SLEEP_MS) continue
    // A `for` header only lists the items (`$(docker ps -q)`); what the loop polls is in its body.
    // A `while`/`until` header is the check itself.
    const status = commandWords(masked, loop.keyword === "for" ? loop.doAt : loop.start, loop.end)
      .filter((word) => STATUS.has(basename(word.text)))
      .find((word) => !batch(header, statement(command, masked, word.start)))
    const cond = loop.keyword === "for" ? undefined : condition(command, loop, counter?.variable)
    let check: string | undefined
    let exits: boolean
    let success: string | undefined
    if (status && !(status.start < loop.doAt && cond && !canonical(statement(command, masked, status.start)))) {
      check = statement(command, masked, status.start)
      const inHeader = status.start < loop.doAt
      const negated = inHeader && /!\s*$/.test(masked.slice(loop.start, status.start))
      exits = inHeader && (loop.keyword === "until" || negated)
      success = exits ? undefined : breakCondition(masked.slice(loop.doAt, loop.end))
    } else {
      // A local check (`until grep -q PASSED ci.log`, `test -f ready && break`): done when it exits 0.
      check = cond
        ? loop.keyword === "until"
          ? cond
          : negate(cond)
        : breakCheck(command, masked, loop, counter?.variable)
      exits = check !== undefined
      if (status === undefined && loop.keyword === "for") {
        // A batch loop acts on each item: its check, or else its body, uses the loop variable.
        const variable = /^\s*for\s+(?:\(\(\s*)?(\w+)/.exec(header)?.[1]
        const subject = check ?? command.slice(loop.doAt, loop.end)
        if (variable !== undefined && uses(subject, variable)) continue
      }
    }
    // `until pg_isready; do sleep 1; done`: a local readiness wait, polled briskly and given up on soon.
    const readiness = exits && waitMs === undefined && (interval === undefined || interval <= READINESS_SLEEP_MS)
    return compact({
      kind: "loop",
      waitMs: waitMs !== undefined && Number.isFinite(waitMs) ? waitMs : undefined,
      before: before(command, masked, loop.start),
      after: trimHead(command.slice(loop.end)),
      suggestion: check
        ? build({
            command: check,
            intervalMs: readiness ? clamp(interval ?? 2_000, MIN_INTERVAL_MS, 2_000) : interval,
            deadlineMs: readiness ? READINESS_DEADLINE_MS : waitMs !== undefined ? waitMs + (interval ?? 0) : undefined,
            success,
          })
        : undefined,
    })
  }
  return undefined
}

function detectWatch(command: string, masked: string): Detection | undefined {
  for (const word of commandWords(masked)) {
    const name = basename(word.text)
    const end = statementEnd(masked, word.start)
    const common = {
      kind: "watch" as const,
      before: before(command, masked, word.start),
      after: trimHead(command.slice(end)),
    }
    if (name === "watch") {
      const parts = command.slice(word.end, end).trim().split(/\s+/)
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
      const observed = parts
        .slice(index)
        .join(" ")
        .replace(/^["']|["']$/g, "")
      if (!observed) continue
      return bound(
        compact({ ...common, suggestion: build({ command: observed, intervalMs: interval }) }),
        leaderTimeout(masked, word.start),
      )
    }
    if (name !== "gh") continue
    const text = command.slice(word.start, end).trim()
    const words = text.split(/\s+/)
    const blocking =
      (words[1] === "run" && words[2] === "watch") ||
      (words[1] === "pr" && words[2] === "checks" && words.includes("--watch"))
    if (!blocking) continue
    const index = words.findIndex((item) => item === "-i" || item === "--interval")
    const interval = index >= 0 ? Number(words[index + 1]) * 1_000 || undefined : undefined
    const limit = leaderTimeout(masked, word.start)
    // `timeout 20 gh run watch 42` gives up on its own before it becomes a wait.
    if (limit !== undefined && limit < LONG_SLEEP_MS) continue
    return bound(
      compact({ ...common, suggestion: build({ command: text, intervalMs: interval ?? DEFAULT_INTERVAL_MS }) }),
      limit,
    )
  }
  return undefined
}

/** A one-shot monitor for the command a sleep was waiting to run. */
function once(command: string): Suggestion {
  return { command, monitor: { mode: "once" } }
}

function detectSleep(command: string, masked: string): Detection | undefined {
  // An unreadable duration (`sleep "$DELAY"`) is only refused inside a polling loop, above.
  const long = sleeps(masked).find((nap) => nap.ms !== undefined && nap.ms >= LONG_SLEEP_MS)
  if (!long) return undefined
  const common = {
    kind: "sleep" as const,
    waitMs: Number.isFinite(long.ms) ? long.ms : undefined,
    before: before(command, masked, long.start),
  }
  const status = commandWords(masked, long.end).find((word) => STATUS.has(basename(word.text)))
  if (status) {
    const end = statementEnd(masked, status.start)
    return compact({
      ...common,
      after: trimHead(command.slice(end)),
      suggestion: build({ command: command.slice(status.start, end).trim(), intervalMs: long.ms }),
    })
  }
  // `sleep 45 && npm test`: the rest is the real work. Inside a loop there is no single rest to name.
  const inside = loops(masked).some((loop) => long.start > loop.start && long.start < loop.end)
  const rest = inside ? undefined : trimHead(command.slice(long.end))
  return compact({ ...common, suggestion: rest ? once(rest) : undefined })
}

/** `bash -c '…'` and friends: the script inside the quotes, and where the quoted argument sits. */
function unwrap(command: string, masked: string) {
  for (const word of commandWords(masked)) {
    if (!SHELLS.has(basename(word.text))) continue
    const match = /^((?:\s+-[A-Za-z]+)*?\s+-[A-Za-z]*c[A-Za-z]*\s+)(?:'([^']*)'|"((?:[^"\\]|\\.)*)")/.exec(
      command.slice(word.end),
    )
    if (!match) continue
    const inner = match[2] ?? match[3]!.replace(/\\(["\\$`])/g, "$1")
    return { inner, word, start: word.end + match[1]!.length, end: word.end + match[0].length }
  }
  return undefined
}

function scan(command: string, masked: string) {
  return detectLoop(command, masked) ?? detectWatch(command, masked) ?? detectSleep(command, masked)
}

export function detect(command: string): Detection | undefined {
  const masked = mask(command)
  const wrapped = unwrap(command, masked)
  if (!wrapped) return scan(command, masked)
  // The suggestion is built from the script itself, never from a fragment cut out of the quotes.
  const found = detect(wrapped.inner)
  if (found) {
    const setup = [before(command, masked, wrapped.word.start), found.before].filter(Boolean).join("\n")
    const rest = [found.after, trimHead(command.slice(wrapped.end))].filter(Boolean).join("\n")
    return bound(
      compact({ ...found, before: setup || undefined, after: rest || undefined }),
      leaderTimeout(masked, wrapped.word.start),
    )
  }
  const blanked =
    masked.slice(0, wrapped.start) +
    masked.slice(wrapped.start, wrapped.end).replace(/[^\n]/g, " ") +
    masked.slice(wrapped.end)
  return scan(command, blanked)
}

/**
 * What a command would change if a poll monitor repeated it. A heuristic over common CLIs, not a
 * classifier: it refuses the obvious cases cheaply, and the tool description covers the rest. It
 * reads the raw text, quotes included, so `bash -c 'git push'` is caught too.
 */
const MUTATING: { label: string; pattern: RegExp }[] = [
  {
    label: "creates or changes GitHub state",
    pattern:
      /\bgh\s+(?:pr\s+(?:create|merge|close|reopen|edit|comment|review|ready)|issue\s+(?:create|close|reopen|edit|comment)|workflow\s+run|run\s+(?:rerun|cancel|delete)|release\s+(?:create|delete|upload|edit)|repo\s+(?:create|delete|fork))\b/i,
  },
  {
    label: "sends a GitHub API request that changes something",
    pattern:
      /\bgh\s+api\b[^\n;&|]*\s(?:-f|-F|--field|--raw-field|--input|-X\s*(?!GET\b)[A-Za-z]+|--method[\s=]+(?!GET\b)[A-Za-z]+)(?=[\s=]|$)/i,
  },
  {
    label: "publishes a package",
    pattern: /\b(?:npm|pnpm|yarn|bun)\s+publish\b/,
  },
  {
    label: "changes the git repository",
    pattern: /\bgit\s+(?:push|commit|merge|rebase|reset|tag|checkout|switch|pull|am|cherry-pick|revert|stash)\b/,
  },
  {
    label: "changes cluster state",
    pattern:
      /\b(?:kubectl|oc)\s+(?:apply|create|delete|patch|replace|scale|set|edit|label|annotate|rollout\s+(?:restart|undo))\b|\bhelm\s+(?:install|upgrade|uninstall|rollback)\b/,
  },
  {
    label: "starts or changes containers",
    pattern:
      /\b(?:docker|podman)\s+(?:run|build|push|rm|rmi|stop|kill|start|restart|compose\s+(?:up|down|build|rm|restart|stop))\b/,
  },
  {
    label: "sends a request that changes something",
    pattern:
      /\bcurl\b[^|;&\n]*\s(?:-X\s*(?:POST|PUT|PATCH|DELETE)\b|--request\s+(?:POST|PUT|PATCH|DELETE)\b|-d\b|--data(?:-\w+)?\b|--json\b|-F\b|--form\b|-T\b|--upload-file\b)/i,
  },
  {
    label: "changes files",
    pattern: /(?:^|[;&|('"]\s*)(?:rm|mv|cp|mkdir|touch|tee|dd|chmod|chown|ln)\s/,
  },
]

export function mutating(command: string) {
  return MUTATING.find((entry) => entry.pattern.test(command))?.label
}

export function mutatingRefusal(label: string) {
  return [
    `Not started: a poll monitor runs its command again every interval_ms, and this command ${label}.`,
    'Run it once as its own bash call (with monitor {"mode":"once"} if it takes long), then poll a read-only status command, for example:',
    ...EXAMPLES.map((example) => call(example)),
  ].join("\n")
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
    detection.suggestion?.monitor.mode === "once"
      ? "Run the command as a one-shot bash monitor instead of sleeping in front of it. It starts now in the background, releases the turn, and resumes this session with the result when it exits."
      : "Wait with a bash monitor instead. It runs the status command in the background every interval_ms, releases the turn, and resumes this session with the result once the condition is met: exit code 0 (and success_contains, if set, is in the output), failure_contains is in the output, or deadline_ms passes.",
  ]
  if (detection.before)
    lines.push(`Run the part before the wait first, as its own bash call without any sleep: ${detection.before}`)
  if (detection.suggestion) {
    lines.push("Retry with this bash call:", call(detection.suggestion, workdir))
    if (
      detection.suggestion.monitor.mode === "poll" &&
      !detection.suggestion.monitor.success_contains &&
      !detection.suggestion.monitor.failure_contains
    )
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
  if (detection.after)
    lines.push(
      `When the monitor reports success, run what came after the wait as its own bash call: ${detection.after}`,
    )
  lines.push(
    "After starting the monitor, end your response or do independent work. Do not sleep, do not call monitor wait repeatedly, and do not start the same monitor twice.",
  )
  return lines.join("\n")
}

/** Under the long-sleep threshold: five tries five seconds apart. */
const BOUNDED_TRIES = 5
const BOUNDED_SLEEP_S = 5

/** A retry loop that gives up within 25 s, so the guard lets it run. */
export function boundedWait(suggestion: Suggestion) {
  const success = suggestion.monitor.mode === "poll" ? suggestion.monitor.success_contains : undefined
  const check = success ? `${suggestion.command} | grep -q '${success.replaceAll("'", "'\\''")}'` : suggestion.command
  const tries = Array.from({ length: BOUNDED_TRIES }, (_, index) => index + 1).join(" ")
  return `for i in ${tries}; do ${check} && break; sleep ${BOUNDED_SLEEP_S}; done`
}

/**
 * The refusal for a runtime with no monitors (the v2 core bash tool): nothing would resume the
 * session after a background wait, so it offers a single check now or a bounded wait instead.
 */
export function boundedRefusal(detection: Detection, workdir?: string) {
  const held = detection.waitMs !== undefined ? ` for up to ${duration(detection.waitMs)}` : ""
  const lines = [
    detection.kind === "loop"
      ? `Not run: this command waits by sleeping in a polling loop, which would block the turn${held}.`
      : detection.kind === "watch"
        ? "Not run: this command watches a job until it ends, which blocks the turn for as long as the job runs."
        : `Not run: this command sleeps${held}, which blocks the turn. Sleeps shorter than ${duration(LONG_SLEEP_MS)} are allowed.`,
    "Long waits are not supported in this mode: there is no background monitor, so nothing would resume this session when the wait ends.",
  ]
  if (detection.before)
    lines.push(`Run the part before the wait first, as its own bash call without any sleep: ${detection.before}`)
  const suggestion = detection.suggestion
  if (suggestion?.monitor.mode === "once") {
    lines.push(
      "Run the command now, without sleeping in front of it:",
      JSON.stringify({ command: suggestion.command, ...(workdir ? { workdir } : {}) }),
    )
  } else {
    const check = suggestion ?? EXAMPLES[0]
    lines.push(
      suggestion
        ? "Instead, run the check once now with this bash call, report the status, and ask the user whether to check again later:"
        : "Instead, run a status check once now, report the status, and ask the user whether to check again later. For example:",
      JSON.stringify({ command: check.command, ...(workdir ? { workdir } : {}) }),
      `If it should be ready within seconds, use a single bounded wait under ${duration(LONG_SLEEP_MS)} instead:`,
      JSON.stringify({ command: boundedWait(check), ...(workdir ? { workdir } : {}) }),
    )
  }
  if (detection.after) lines.push(`Once the check reports success, run what came after the wait as its own bash call: ${detection.after}`)
  lines.push("Do not retry with a longer sleep or a larger timeout.")
  return lines.join("\n")
}

export * as ShellPolling from "./shell-polling"
