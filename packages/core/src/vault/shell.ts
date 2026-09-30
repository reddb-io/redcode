export * as VaultShell from "./shell.js"

import { reference } from "@opencode/schema/vault"
import { ShellSelect } from "../shell/select.js"

/**
 * A shell command whose `{vault:name}` references carry their values into what runs, while the command that is
 * stored, approved and shown keeps the names.
 *
 * POSIX shells and PowerShell run a script read from standard input: the command with each value written in,
 * escaped for the quoting it sits in, so bare words, `'…'`, `"…"`, `$'…'`, `$(…)` and quoted heredoc bodies all
 * work and no value is in the shell's argument vector. Where escaping cannot be trusted, inside backticks and in
 * bodies that expand (an unquoted heredoc, a PowerShell `@"…"@`), the script expands an environment variable set
 * only for the child instead, which the shell reads as data whatever the value holds. A value that would end a
 * literal heredoc early fails with a reason, since nothing expands there. A backslash before a reference keeps it
 * literal. `cmd` has no reliable quoting, so there references become variables in the command itself.
 */
export type Bound =
  | { readonly failure: string }
  | {
      /** What the shell reads on standard input, with values in place; undefined when `command` runs itself. */
      readonly script: string | undefined
      /** What is stored and shown, and what runs without a script. */
      readonly command: string
      /** Variables set only for the child process. */
      readonly env: Readonly<Record<string, string>>
    }

type Variable = (name: string) => string

const REFERENCE = /\{vault:([a-z0-9][a-z0-9-]{0,63})\}/y
const ANY_REFERENCE = /\{vault:([a-z0-9][a-z0-9-]{0,63})\}/g

export function bind(command: string, shell: string, values: ReadonlyMap<string, string>): Bound {
  const variables = new Map<string, string>()
  const variable = (name: string) => {
    const existing = variables.get(name)
    if (existing !== undefined) return existing
    const created = `REDCODE_VAULT_${variables.size + 1}`
    variables.set(name, created)
    return created
  }
  const env = () => Object.fromEntries(Array.from(variables, ([name, key]) => [key, values.get(name) ?? ""]))
  if (ShellSelect.name(shell) === "cmd")
    return {
      script: undefined,
      command: command.replace(ANY_REFERENCE, (match: string, name: string) =>
        values.has(name) ? `%${variable(name)}%` : match,
      ),
      env: env(),
    }
  const nul = Array.from(values).find((entry) => entry[1].includes("\0"))
  if (nul) return { failure: `${reference(nul[0])} holds a NUL character, which no shell script can carry.` }
  const script = ShellSelect.ps(shell) ? powershell(command, values, variable) : posix(command, values, variable)
  if (typeof script !== "string") return script
  return { script, command, env: env() }
}

type PosixFrame =
  | { readonly kind: "code"; readonly close: ")" | "`" | undefined; readonly arithmetic: boolean; depth: number }
  | { readonly kind: "single" }
  | { readonly kind: "double" }
  | { readonly kind: "ansi" }

type Heredoc = { readonly delimiter: string; readonly quoted: boolean; readonly strip: boolean }

function posix(command: string, values: ReadonlyMap<string, string>, variable: Variable) {
  const out: string[] = []
  const stack: PosixFrame[] = [{ kind: "code", close: undefined, arithmetic: false, depth: 0 }]
  const heredocs: Heredoc[] = []
  const failures: string[] = []
  // Backticks process backslashes, dollars and backticks once more, so a value there reads a variable instead.
  const backticked = () => stack.some((frame) => frame.kind === "code" && frame.close === "`")
  const write = (kind: PosixFrame["kind"], name: string, value: string) => {
    const plain = !backticked()
    if (kind === "code") return plain ? `'${value.replaceAll("'", `'\\''`)}'` : `"\${${variable(name)}}"`
    if (kind === "single") return plain ? value.replaceAll("'", `'\\''`) : `'"\${${variable(name)}}"'`
    if (kind === "double") return plain ? value.replace(/[\\$`"]/g, "\\$&") : `\${${variable(name)}}`
    return plain ? value.replace(/[\\']/g, "\\$&") : `'"\${${variable(name)}}"$'`
  }
  const body = (line: string, doc: Heredoc) =>
    line.replace(ANY_REFERENCE, (match: string, name: string, offset: number) => {
      const value = values.get(name)
      if (value === undefined || (!doc.quoted && line[offset - 1] === "\\")) return match
      if (!doc.quoted) return `\${${variable(name)}}`
      if (value.split("\n").some((part) => terminates(part, doc)))
        failures.push(`${match} would end the quoted heredoc ${doc.delimiter} early; use an unquoted heredoc instead.`)
      return value
    })
  let index = 0
  while (index < command.length) {
    const frame = stack[stack.length - 1]
    const char = command[index]
    const next = command[index + 1] ?? ""
    REFERENCE.lastIndex = index
    const found = char === "{" ? REFERENCE.exec(command) : null
    const value = found ? values.get(found[1]) : undefined
    if (found && value !== undefined) {
      out.push(write(frame.kind, found[1], value))
      index += found[0].length
      continue
    }
    if (frame.kind === "single") {
      if (char === "'") stack.pop()
      out.push(char)
      index++
      continue
    }
    // An escaped character is copied with its backslash, so `\{vault:name}` stays literal.
    if (char === "\\") {
      out.push(command.slice(index, index + 2))
      index += 2
      continue
    }
    if (frame.kind === "ansi") {
      if (char === "'") stack.pop()
      out.push(char)
      index++
      continue
    }
    if (char === "$" && next === "(") {
      stack.push({ kind: "code", close: ")", arithmetic: command[index + 2] === "(", depth: 0 })
      out.push("$(")
      index += 2
      continue
    }
    if (frame.kind === "double") {
      if (char === '"') stack.pop()
      if (char === "`") stack.push({ kind: "code", close: "`", arithmetic: false, depth: 0 })
      out.push(char)
      index++
      continue
    }
    if (char === "#" && /^[\s;&|()]?$/.test(command[index - 1] ?? "")) {
      const end = command.indexOf("\n", index)
      out.push(command.slice(index, end < 0 ? command.length : end))
      index = end < 0 ? command.length : end
      continue
    }
    const arithmetic = stack.some((item) => item.kind === "code" && item.arithmetic)
    if (char === "<" && next === "<" && command[index + 2] !== "<" && !arithmetic) {
      const heredoc = readHeredoc(command, index + 2)
      if (heredoc.doc) heredocs.push(heredoc.doc)
      out.push(command.slice(index, heredoc.end))
      index = heredoc.end
      continue
    }
    if (char === "$" && (next === "'" || next === '"')) {
      stack.push(next === "'" ? { kind: "ansi" } : { kind: "double" })
      out.push(char, next)
      index += 2
      continue
    }
    if (char === "'") stack.push({ kind: "single" })
    if (char === '"') stack.push({ kind: "double" })
    if (char === "`" && frame.close === "`") stack.pop()
    if (char === "`" && frame.close !== "`") stack.push({ kind: "code", close: "`", arithmetic: false, depth: 0 })
    if (char === "(" && frame.close === ")") frame.depth++
    if (char === ")" && frame.close === ")" && frame.depth === 0) stack.pop()
    if (char === ")" && frame.close === ")" && frame.depth > 0) frame.depth--
    out.push(char)
    index++
    // Heredoc bodies start on the line after the one that opened them, in the order they were opened.
    while (char === "\n" && heredocs.length > 0 && index < command.length) {
      const doc = heredocs[0]
      heredocs.shift()
      index = readBody(command, index, doc, (line, terminator) => out.push(terminator ? line : body(line, doc)))
    }
  }
  if (failures.length > 0) return { failure: failures[0] }
  return out.join("")
}

/**
 * The delimiter after `<<` or `<<-` at `start`, and where its word ends; a quoted delimiter keeps the body literal.
 * A word that does not start like a delimiter, such as the `2` of `1<<2`, is no heredoc.
 */
function readHeredoc(command: string, start: number) {
  const strip = command[start] === "-"
  let cursor = strip ? start + 1 : start
  while (command[cursor] === " " || command[cursor] === "\t") cursor++
  if (!/[A-Za-z_'"\\]/.test(command[cursor] ?? "")) return { end: start, doc: undefined }
  const parts: string[] = []
  let quoted = false
  while (cursor < command.length && !/[\s;&|<>()]/.test(command[cursor])) {
    const char = command[cursor]
    if (char === "'" || char === '"') {
      const close = command.indexOf(char, cursor + 1)
      const end = close < 0 ? command.length : close
      parts.push(command.slice(cursor + 1, end))
      quoted = true
      cursor = end + 1
      continue
    }
    if (char === "\\") {
      parts.push(command[cursor + 1] ?? "")
      quoted = true
      cursor += 2
      continue
    }
    parts.push(char)
    cursor++
  }
  const delimiter = parts.join("")
  return { end: Math.min(cursor, command.length), doc: delimiter ? { delimiter, quoted, strip } : undefined }
}

/** Hands each line of a heredoc body on, through its terminator line; where the command continues. */
function readBody(command: string, start: number, doc: Heredoc, emit: (line: string, terminator: boolean) => void) {
  let index = start
  while (index < command.length) {
    const end = command.indexOf("\n", index)
    const stop = end < 0 ? command.length : end + 1
    const line = command.slice(index, stop)
    const terminator = terminates(line.replace(/\n$/, ""), doc)
    emit(line, terminator)
    index = stop
    if (terminator) break
  }
  return index
}

function terminates(line: string, doc: Heredoc) {
  return (doc.strip ? line.replace(/^\t+/, "") : line).replace(/\r$/, "") === doc.delimiter
}

type PowerShellFrame =
  | { readonly kind: "code"; readonly close: boolean; depth: number }
  | { readonly kind: "single" }
  | { readonly kind: "double" }
  | { readonly kind: "here-single" }
  | { readonly kind: "here-double" }

// PowerShell also reads typographic quotes as quotes.
const PS_SINGLE = "'\u2018\u2019\u201a\u201b"
const PS_DOUBLE = '"\u201c\u201d\u201e'

function powershell(command: string, values: ReadonlyMap<string, string>, variable: Variable) {
  const out: string[] = []
  const stack: PowerShellFrame[] = [{ kind: "code", close: false, depth: 0 }]
  const failures: string[] = []
  const doubled = (value: string) => value.replace(/['\u2018\u2019\u201a\u201b]/g, "$&$&")
  const write = (kind: PowerShellFrame["kind"], name: string, value: string) => {
    if (kind === "code") return `'${doubled(value)}'`
    if (kind === "single") return doubled(value)
    if (kind === "double") return value.replace(/[`$"\u201c\u201d\u201e]/g, "`$&")
    if (kind === "here-double") return `\${env:${variable(name)}}`
    if (value.split("\n").some((line) => PS_SINGLE.includes(line[0] ?? "") && line[1] === "@"))
      failures.push(`${reference(name)} would end the literal here-string early; use a double-quoted one instead.`)
    return value
  }
  let index = 0
  while (index < command.length) {
    const frame = stack[stack.length - 1]
    const char = command[index]
    const next = command[index + 1] ?? ""
    const lineStart = index === 0 || command[index - 1] === "\n"
    REFERENCE.lastIndex = index
    const found = char === "{" ? REFERENCE.exec(command) : null
    const value = found ? values.get(found[1]) : undefined
    if (found && value !== undefined) {
      out.push(write(frame.kind, found[1], value))
      index += found[0].length
      continue
    }
    // A doubled quote inside a quoted string is one literal quote; a here-string ends only at a line start.
    if (frame.kind === "single" || frame.kind === "here-single") {
      const escaped = frame.kind === "single" && PS_SINGLE.includes(char) && PS_SINGLE.includes(next)
      const closes =
        frame.kind === "single" ? PS_SINGLE.includes(char) : lineStart && PS_SINGLE.includes(char) && next === "@"
      if (closes && !escaped) stack.pop()
      const length = escaped || (closes && frame.kind === "here-single") ? 2 : 1
      out.push(command.slice(index, index + length))
      index += length
      continue
    }
    if (char === "`") {
      out.push(command.slice(index, index + 2))
      index += 2
      continue
    }
    if (char === "$" && next === "(") {
      stack.push({ kind: "code", close: true, depth: 0 })
      out.push("$(")
      index += 2
      continue
    }
    if (frame.kind === "double" || frame.kind === "here-double") {
      const escaped = frame.kind === "double" && PS_DOUBLE.includes(char) && PS_DOUBLE.includes(next)
      const closes =
        frame.kind === "double" ? PS_DOUBLE.includes(char) : lineStart && PS_DOUBLE.includes(char) && next === "@"
      if (closes && !escaped) stack.pop()
      const length = escaped || (closes && frame.kind === "here-double") ? 2 : 1
      out.push(command.slice(index, index + length))
      index += length
      continue
    }
    if (char === "#" && /^[\s;|(]?$/.test(command[index - 1] ?? "")) {
      const end = command.indexOf("\n", index)
      out.push(command.slice(index, end < 0 ? command.length : end))
      index = end < 0 ? command.length : end
      continue
    }
    if (char === "<" && next === "#") {
      const end = command.indexOf("#>", index + 2)
      const stop = end < 0 ? command.length : end + 2
      out.push(command.slice(index, stop))
      index = stop
      continue
    }
    const here = char === "@" ? /^[ \t]{0,32}\r?\n/.exec(command.slice(index + 2, index + 40)) : null
    if (here && (PS_SINGLE.includes(next) || PS_DOUBLE.includes(next))) {
      stack.push(PS_SINGLE.includes(next) ? { kind: "here-single" } : { kind: "here-double" })
      out.push(command.slice(index, index + 2 + here[0].length))
      index += 2 + here[0].length
      continue
    }
    if (PS_SINGLE.includes(char)) stack.push({ kind: "single" })
    if (PS_DOUBLE.includes(char)) stack.push({ kind: "double" })
    if (char === "(" && frame.close) frame.depth++
    if (char === ")" && frame.close && frame.depth === 0) stack.pop()
    if (char === ")" && frame.close && frame.depth > 0) frame.depth--
    out.push(char)
    index++
  }
  if (failures.length > 0) return { failure: failures[0] }
  return out.join("")
}
