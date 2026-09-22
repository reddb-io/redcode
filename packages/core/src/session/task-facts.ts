export * as SessionTaskFacts from "./task-facts"

import { createHash } from "node:crypto"
import path from "node:path"
import { and, eq, isNull } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { MessageTable, PartTable, SessionInputTable, SessionMessageTable, SessionTable } from "./sql"
import { SessionV1 } from "../v1/session"

export type Kind = "edit" | "verification" | "bookkeeping" | "other"
export type Result = {
  callID: string
  messageID: string
  tool: string
  hash: string
  completed: number
  successful: boolean
  errored: boolean
  /** File edits invalidate earlier evidence; verification commands are evidence but never invalidate. */
  kind: Kind
  /**
   * Files an edit touched, when the input names them, absolute against the session directory; a design
   * tool's scope is its design (`design:<id>`). Empty means unknown, which matches every proof.
   */
  paths: string[]
  settled: boolean
  /**
   * Left pending or running in an assistant message that has since closed — a crashed or aborted
   * turn. Such a part is reported settled and errored: it neither proves nor invalidates anything,
   * and it is not "still running".
   */
  abandoned: boolean
  /** The failure text of an errored result; empty otherwise. */
  error: string
  input: unknown
  summary: string
}
/** A user request as the task gate reads it; `pending` when admitted to the inbox but not promoted. */
export type Request = { id: string; text: string; created: number; pending?: boolean }
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex")
const edits = new Set(["write", "edit", "apply_patch", "multiedit", "design_edit", "design_generate", "design_asset"])
/**
 * Results that check work rather than change it: shell commands (successful only on exit 0) and the
 * design tools that render or export the current revision. Only these are ever selected as evidence
 * on the model's behalf, and they never invalidate earlier evidence.
 */
const verifications = new Set(["bash", "shell", "design_preview", "design_export"])
const bookkeeping = new Set(["todowrite", "todoread", "plan_exit", "goal_status", "goal_complete"])
export const kind = (tool: string): Kind =>
  edits.has(tool) ? "edit" : verifications.has(tool) ? "verification" : bookkeeping.has(tool) ? "bookkeeping" : "other"

/** Scope of a design tool's result: the design it edited, previewed or exported, not a file. */
export const DESIGN = "design:"
const designs = new Set(["design_edit", "design_generate", "design_asset", "design_preview", "design_export"])
const scoped = (entries: ReadonlyArray<string>) =>
  entries.length > 0 && entries.every((entry) => entry.startsWith(DESIGN))

const DRIVE = /^[A-Za-z]:/
/** A raw path spelled the Windows way: a drive letter, a backslash, or `/C:/`. */
const windowsish = (entry: string) => DRIVE.test(entry) || entry.includes("\\") || /^\/[A-Za-z]:(\/|$)/.test(entry)

/**
 * Forward slashes and a lower-case drive. Win32 device prefixes (`\\?\C:\`, `\\.\C:\`, `\\?\UNC\`) and
 * `/C:/` are unwrapped. When Windows is in play, git-bash's `/c/` names drive C and the whole path is
 * lower-cased, because Windows paths are case-insensitive; on POSIX, `/c` is an ordinary directory.
 */
const posix = (entry: string, windows: boolean) => {
  let value = entry
    .replaceAll("\\", "/")
    .replace(/^\/\/[?.]\/UNC\//i, "//")
    .replace(/^\/\/[?.]\/(?=[A-Za-z]:)/, "")
    .replace(/^\/(?=[A-Za-z]:(\/|$))/, "")
  if (windows) value = value.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:").toLowerCase()
  return DRIVE.test(value) ? value[0]!.toLowerCase() + value.slice(1) : value
}
/** `c:/a` → `c:` and `/a`; `c:a` (drive-relative) → `c:` and `a`; no drive → `` and the path. */
const drive = (entry: string) => {
  const match = /^[a-z]:/.exec(entry)
  return match ? ([match[0], entry.slice(2)] as const) : (["", entry] as const)
}
/** A relative path with no base: `./` and leading `../` only say the root is unknown. */
const unrooted = (rest: string) =>
  path.posix
    .normalize(rest || ".")
    .replace(/^(\.\.?\/)+/, "")
    .replace(/^\.\.?$/, "")
const trim = (entry: string) => (entry.length > 1 ? entry.replace(/\/+$/, "") : entry)

/**
 * One spelling for a path on every platform: forward slashes, `.` and `..` resolved, relative forms
 * joined to the session directory, a lower-case drive kept and a UNC root's double slash kept. A
 * drive-relative `C:foo` never borrows another drive's directory: its root on C is unknown.
 */
const normal = (entry: string, directory?: string, windows = false) => {
  if (entry.startsWith(DESIGN)) return entry
  const win = windows || windowsish(entry) || (!!directory && windowsish(directory))
  const value = posix(entry, win)
  const [root, rest] = drive(value)
  if (rest.startsWith("/")) {
    const unc = rest.startsWith("//") ? "/" : ""
    return root + unc + trim(path.posix.normalize(rest))
  }
  if (root || !directory) return root + trim(unrooted(rest))
  const [base, within] = drive(posix(directory, win))
  const unc = within.startsWith("//") ? "/" : ""
  return base + unc + trim(path.posix.join(within || "/", rest))
}

/**
 * Whether two normalised paths name the same file or one contains the other. A path without a drive
 * matches either drive; paths on different drives never overlap. A relative path, whose root is
 * unknown, overlaps any path containing it as whole segments, and an empty one overlaps everything.
 */
const related = (left: string, right: string) => {
  const [dx, x] = drive(left)
  const [dy, y] = drive(right)
  if (dx && dy && dx !== dy) return false
  if (!x || !y) return true
  const inside = (outer: string, inner: string) =>
    !inner.startsWith("/") && (outer.includes(`/${inner}/`) || outer.startsWith(`${inner}/`))
  return (
    x === y ||
    x.endsWith(`/${y}`) ||
    y.endsWith(`/${x}`) ||
    x.startsWith(`${y}/`) ||
    y.startsWith(`${x}/`) ||
    inside(x, y) ||
    inside(y, x)
  )
}

/**
 * Whether an edit's files overlap a proof's files; a side without paths is treated as touching
 * everything, and a directory (a grep or glob root) overlaps the files beneath it. A design edit is
 * scoped to its design: it overlaps only proofs about that design, never a shell check or a read. A
 * file edit still overlaps a design proof, whose files are not known.
 */
export const overlaps = (edit: ReadonlyArray<string>, proof: ReadonlyArray<string>) => {
  // A Windows path on either side makes the comparison a Windows one for both.
  const windows = [...edit, ...proof].some(windowsish)
  const a = edit.map((entry) => normal(entry, undefined, windows))
  const b = proof.map((entry) => normal(entry, undefined, windows))
  if (scoped(a)) return b.some((entry) => a.includes(entry))
  if (scoped(b)) return true
  return !a.length || !b.length || a.some((x) => b.some((y) => related(x, y)))
}

/**
 * What a tool's input names: explicit path fields or the file headers of a patch, resolved against the
 * session directory, or the design a design tool works on.
 */
export function paths(tool: string, input: unknown, directory?: string): string[] {
  if (bookkeeping.has(tool) || typeof input !== "object" || input === null) return []
  const record = input as Record<string, unknown>
  if (designs.has(tool)) return typeof record.id === "string" && record.id ? [`${DESIGN}${record.id}`] : []
  if (verifications.has(tool)) return []
  const named = ["filePath", "path", "file_path"].flatMap((key) =>
    typeof record[key] === "string" && record[key] ? [record[key] as string] : [],
  )
  const patch =
    typeof record.patchText === "string"
      ? [...record.patchText.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((match) =>
          match[1]!.trim(),
        )
      : []
  return [...new Set([...named, ...patch].map((entry) => normal(entry, directory)))]
}

const inspecting = new Set([
  "ls",
  "cat",
  "pwd",
  "echo",
  "printf",
  "true",
  ":",
  "head",
  "tail",
  "wc",
  "find",
  "grep",
  "rg",
  "which",
  "type",
  "stat",
  "file",
  "tree",
  "less",
  "more",
  "whoami",
  "date",
  "env",
  "cd",
  "du",
  "df",
])
const inspectingGit = new Set(["status", "diff", "log", "show", "branch", "remote", "rev-parse"])
const shells = new Set(["bash", "sh", "zsh", "dash"])

type Word = { text: string; quoted: boolean }
/**
 * Splits a command into steps of words, honouring quotes and backslashes. Returns `undefined` for
 * anything it will not vouch for: a redirect into a file, command substitution or an unclosed quote.
 */
function steps(command: string): Word[][] | undefined {
  const out: Word[][] = [[]]
  let word: Word | undefined
  const push = () => {
    if (word) out.at(-1)!.push(word)
    word = undefined
  }
  const extend = (text: string, quoted = false) => {
    word = { text: (word?.text ?? "") + text, quoted: (word?.quoted ?? false) || quoted }
  }
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!
    if (char === "'" || char === '"') {
      const end = command.indexOf(char, i + 1)
      if (end === -1) return undefined
      const inner = command.slice(i + 1, end)
      if (char === '"' && /\$\(|`/.test(inner)) return undefined
      extend(inner, true)
      i = end
      continue
    }
    if (char === "\\") {
      extend(command[i + 1] ?? "")
      i++
      continue
    }
    if (char === "`" || (char === "$" && command[i + 1] === "(")) return undefined
    if (/\s/.test(char) && char !== "\n") {
      push()
      continue
    }
    if (char === ">") {
      // Only a duplicate of another descriptor (`2>&1`) or a discard (`>/dev/null`) writes nothing.
      const fd = word && !word.quoted && /^\d*$/.test(word.text) ? word : undefined
      if (word && !fd) push()
      word = undefined
      let j = i + 1
      if (command[j] === ">") j++
      if (command[j] === "&" && /\d|-/.test(command[j + 1] ?? "")) {
        i = j + 1
        continue
      }
      while (command[j] === " ") j++
      if (!command.startsWith("/dev/null", j) || /[^\s;&|)]/.test(command[j + 9] ?? " ")) return undefined
      i = j + 8
      continue
    }
    if (char === "<") {
      push()
      continue
    }
    if (";|&\n()".includes(char)) {
      push()
      if (out.at(-1)!.length) out.push([])
      continue
    }
    extend(char)
  }
  push()
  return out.filter((step) => step.length)
}

/** One sed command that only prints: an optional address or range, then `p`, `=`, `q`, `n` or nothing. */
const SED_ADDRESS = String.raw`(?:\d+|\$|\/(?:[^\/\\]|\\.)*\/)(?:~\d+)?`
const SED_PRINT = new RegExp(
  String.raw`^\s*(?:${SED_ADDRESS}(?:\s*,\s*(?:${SED_ADDRESS}|[+~]\d+))?)?\s*!?\s*[p=qn]?\s*$`,
)

/**
 * `sed -n` with scripts made only of addresses and print commands. Anything else can write: `w`, `W`,
 * `e`, an `s` with a `w` or `e` flag, a script file, or editing in place.
 */
function sedPrints(args: string[]) {
  if (!args.some((arg) => /^-[A-Za-z]*n[A-Za-z]*$/.test(arg) || arg === "--quiet" || arg === "--silent")) return false
  if (args.some((arg) => /^-[A-Za-z]*[if]/.test(arg) || arg.startsWith("--in-place") || arg.startsWith("--file")))
    return false
  const scripts: string[] = []
  let explicit = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === "-e" || arg === "--expression") {
      explicit = true
      scripts.push(args[++index] ?? "")
    } else if (arg.startsWith("--expression=")) {
      explicit = true
      scripts.push(arg.slice("--expression=".length))
    }
  }
  if (!explicit) {
    const script = args.find((arg) => !arg.startsWith("-"))
    if (script === undefined) return false
    scripts.push(script)
  }
  return scripts.every((script) => script.split(/[;\n]/).every((command) => SED_PRINT.test(command)))
}

function inspects(words: Word[]): boolean {
  const args = words.map((entry) => entry.text)
  while (args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0]!)) args.shift()
  const [program, ...rest] = args
  if (program === undefined) return true
  if (program === "env") {
    const index = rest.findIndex((arg) => !arg.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))
    return index === -1 || inspects(rest.slice(index).map((text) => ({ text, quoted: false })))
  }
  if (shells.has(program)) {
    const flag = rest.findIndex((arg) => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg))
    return flag !== -1 && rest[flag + 1] !== undefined && readOnly({ command: rest[flag + 1] })
  }
  if (program === "git") {
    let index = 0
    while (index < rest.length && rest[index]!.startsWith("-")) index += ["-C", "-c"].includes(rest[index]!) ? 2 : 1
    const [sub, ...options] = rest.slice(index)
    if (!sub || !inspectingGit.has(sub)) return false
    // `git branch x`, `git branch -D x` and `git remote add` change things; bare listings do not.
    if (sub === "branch")
      return options.every((arg) => ["-a", "-r", "-v", "-vv", "--all", "--list", "--show-current"].includes(arg))
    if (["log", "diff", "show"].includes(sub) && options.some((arg) => arg.startsWith("--output"))) return false
    if (sub === "remote")
      return options.every((arg) => ["-v", "--verbose"].includes(arg)) || ["show", "get-url"].includes(options[0] ?? "")
    return true
  }
  if (program === "sed") return sedPrints(rest)
  if (program === "find")
    return !rest.some((arg) =>
      ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"].includes(arg),
    )
  if (program === "tree") return !rest.some((arg) => arg === "-o" || arg.startsWith("-o"))
  if (program === "rg") return !rest.some((arg) => arg === "--pre" || arg.startsWith("--pre="))
  return inspecting.has(program)
}

/**
 * A shell command that only looks at things: every step of it is a listing, a print, a search, a
 * `sed -n` or a read-only git query, including inside `bash -c` and subshells, with no output
 * redirected into a file. Exiting 0 proves nothing about a task, so such a command is never recorded
 * as a verification on the model's behalf.
 */
export function readOnly(input: unknown): boolean {
  const value = typeof input === "object" && input !== null ? (input as { command?: unknown }).command : undefined
  if (typeof value !== "string" || !value.trim()) return false
  const parsed = steps(value)
  return !!parsed && parsed.every(inspects)
}

/** The command a shell result ran, cut to `limit` characters, for quoting it back to the model. */
export function command(input: unknown, limit = 120) {
  const value = typeof input === "object" && input !== null ? (input as { command?: unknown }).command : undefined
  if (typeof value !== "string" || !value.trim()) return undefined
  const text = value.trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

const make = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const load = Effect.fn("SessionTaskFacts.load")(function* (sessionID: SessionSchema.ID) {
    const directory =
      (yield* db
        .select({ directory: SessionTable.directory })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .all()
        .pipe(Effect.orDie))[0]?.directory || undefined
    const rows = yield* db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, sessionID))
      .all()
      .pipe(Effect.orDie)
    const messages = rows.map((row) =>
      Schema.decodeUnknownSync(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }),
    )
    const requests = messages.flatMap((message) =>
      message.type === "user"
        ? [{ id: message.id, text: message.text, created: DateTime.toEpochMillis(message.time.created) }]
        : [],
    )
    const results: Result[] = messages.flatMap((message) =>
      message.type === "assistant"
        ? message.content.flatMap((part) => {
            const closed =
              message.time.completed !== undefined || message.finish !== undefined || message.error !== undefined
            if (part.type !== "tool") return []
            const input = part.state.status === "pending" ? undefined : part.state.input
            const settled = part.state.status === "completed" || part.state.status === "error"
            const abandoned = !settled && closed
            return [
              {
                callID: part.id,
                messageID: message.id,
                tool: part.name,
                hash: hash(part.state),
                completed: DateTime.toEpochMillis(part.time.completed ?? part.time.ran ?? part.time.created),
                successful: part.state.status === "completed" && success(part.name, part.state.structured),
                errored: part.state.status === "error" || abandoned,
                kind: kind(part.name),
                paths: paths(part.name, input, directory),
                settled: settled || abandoned,
                abandoned,
                error: part.state.status === "error" ? text(part.state.error) : "",
                input,
                summary: JSON.stringify({
                  input: part.state.input,
                  status: part.state.status,
                  output:
                    part.state.status === "completed"
                      ? part.state.content.filter((item) => item.type === "text")
                      : undefined,
                }),
              },
            ]
          })
        : [],
    )
    // A legacy session keeps its conversation in MessageTable/PartTable and still gains projected
    // rows here (a context update, an agent switch), so both stores are read and merged; a v2
    // session simply has no legacy rows. Returning early on any projected row emptied the legacy
    // requests and results for the rest of the session.
    const legacy = yield* loadLegacy(sessionID, directory)
    // A prompt admitted to the inbox but not promoted yet is not visible to the model: it is flagged,
    // so a task never falls back to it, though its words can still be quoted.
    const pending = new Set<string>(
      (yield* db
        .select({ id: SessionInputTable.id })
        .from(SessionInputTable)
        .where(and(eq(SessionInputTable.session_id, sessionID), isNull(SessionInputTable.promoted_seq)))
        .all()
        .pipe(Effect.orDie)).map((row) => row.id),
    )
    const requestIDs = new Set<string>(requests.map((entry) => entry.id))
    const resultIDs = new Set(results.map((entry) => `${entry.messageID}:${entry.callID}`))
    return {
      requests: [...requests, ...legacy.requests.filter((entry) => !requestIDs.has(entry.id))].map(
        (entry): Request => (pending.has(entry.id) ? { ...entry, pending: true } : entry),
      ),
      results: [...results, ...legacy.results.filter((entry) => !resultIDs.has(`${entry.messageID}:${entry.callID}`))],
    }
  })
  const loadLegacy = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, directory: string | undefined) {
    const legacy = yield* db
      .select()
      .from(MessageTable)
      .where(eq(MessageTable.session_id, sessionID))
      .all()
      .pipe(Effect.orDie)
    const parts = (yield* db
      .select()
      .from(PartTable)
      .where(eq(PartTable.session_id, sessionID))
      .all()
      .pipe(Effect.orDie)).map((row) =>
      Schema.decodeUnknownSync(SessionV1.Part)({ ...row.data, id: row.id, sessionID, messageID: row.message_id }),
    )
    // Parts grouped by message once, so reading every request does not rescan every part.
    const byMessage = new Map<string, typeof parts>()
    for (const part of parts) byMessage.set(part.messageID, [...(byMessage.get(part.messageID) ?? []), part])
    const assistants = new Map(
      legacy.flatMap((row) => {
        if (row.data.role !== "assistant") return []
        const data = row.data as { time: { completed?: number }; error?: unknown }
        // A closed assistant message is not running anything any more.
        return [[row.id, data.time.completed !== undefined || data.error !== undefined] as const]
      }),
    )
    return {
      requests: legacy.flatMap((row) => {
        if (row.data.role !== "user") return []
        const text = (byMessage.get(row.id) ?? [])
          .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : []))
          .join("\n")
        return text ? [{ id: row.id, text, created: row.data.time.created }] : []
      }),
      results: parts.flatMap((part): Result[] => {
        if (part.type !== "tool" || !assistants.has(part.messageID)) return []
        const settled = part.state.status === "completed" || part.state.status === "error"
        const abandoned = !settled && assistants.get(part.messageID) === true
        return [
          {
            callID: part.callID,
            messageID: part.messageID,
            tool: part.tool,
            hash: hash(
              part.state.status === "completed"
                ? {
                    status: part.state.status,
                    input: part.state.input,
                    output: part.state.output,
                    metadata: part.state.metadata,
                  }
                : part.state,
            ),
            completed:
              part.state.status === "pending"
                ? 0
                : "end" in part.state.time
                  ? part.state.time.end
                  : part.state.time.start,
            successful: part.state.status === "completed" && success(part.tool, part.state.metadata),
            errored: part.state.status === "error" || abandoned,
            kind: kind(part.tool),
            paths: paths(part.tool, part.state.input, directory),
            settled: settled || abandoned,
            abandoned,
            error: part.state.status === "error" ? text(part.state.error) : "",
            input: part.state.input,
            summary: JSON.stringify({
              input: part.state.input,
              status: part.state.status,
              output: part.state.status === "completed" ? part.state.output : undefined,
            }),
          },
        ]
      }),
    }
  })
  const available = Effect.fn("SessionTaskFacts.available")(function* (sessionID: SessionSchema.ID) {
    const facts = yield* load(sessionID)
    return {
      requests: facts.requests
        .toSorted((a, b) => b.created - a.created)
        .slice(0, 5)
        .map((request) => ({ ...request, text: request.text.slice(0, 1200) })),
      results: facts.results
        .filter((result) => result.kind !== "bookkeeping")
        .toSorted((a, b) => b.completed - a.completed)
        .slice(0, 20)
        .map((result) => ({
          callID: result.callID,
          messageID: result.messageID,
          tool: result.tool,
          successful: result.successful,
          summary:
            result.summary.length > 12000
              ? result.summary.slice(0, 12000) +
                "\n[Result truncated; inspect the original tool result before claiming completion.]"
              : result.summary,
        })),
    }
  })
  return { load, available }
})

function text(error: unknown) {
  if (typeof error === "string") return error
  if (typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string")
    return (error as { message: string }).message
  return ""
}

function success(tool: string, data: Record<string, unknown>) {
  if (bookkeeping.has(tool) || data.error || data.isError || data.timeout) return false
  if (tool === "bash" || tool === "shell") return data.exit === 0 || data.exitCode === 0
  return true
}

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@redcode/SessionTaskFacts") {}
export const node = makeGlobalNode({ service: Service, layer: Layer.effect(Service, make), deps: [Database.node] })
