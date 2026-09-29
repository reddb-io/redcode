export * as VaultShell from "./shell.js"

import { ShellSelect } from "../shell/select.js"

type Quote = "none" | "single" | "double"

const REFERENCE = /\{vault:([a-z0-9][a-z0-9-]{0,63})\}/y
const ANY_REFERENCE = /\{vault:([a-z0-9][a-z0-9-]{0,63})\}/g

/**
 * A shell command whose `{vault:name}` references read environment variables set only for its child process, so a
 * value is neither in the argument vector other processes can list nor in the command that is stored and shown.
 * A POSIX shell keeps the quoting the reference sits in, and a backslash before it keeps it literal; `cmd` and
 * PowerShell use their own variable syntax, and PowerShell does not expand one inside single quotes.
 */
export function bind(command: string, shell: string, values: ReadonlyMap<string, string>) {
  const variables = new Map<string, string>()
  const variable = (name: string) => {
    const existing = variables.get(name)
    if (existing !== undefined) return existing
    const created = `REDCODE_VAULT_${variables.size + 1}`
    variables.set(name, created)
    return created
  }
  const rewritten =
    ShellSelect.name(shell) === "cmd"
      ? command.replace(ANY_REFERENCE, (_match, name: string) => `%${variable(name)}%`)
      : ShellSelect.ps(shell)
        ? command.replace(ANY_REFERENCE, (_match, name: string) => `\${env:${variable(name)}}`)
        : posix(command, (name, quote) => expansion(variable(name), quote))
  return {
    command: rewritten,
    env: Object.fromEntries(Array.from(variables, ([name, key]) => [key, values.get(name) ?? ""])),
  }
}

function expansion(variable: string, quote: Quote) {
  if (quote === "double") return `\${${variable}}`
  if (quote === "single") return `'"\${${variable}}"'`
  return `"\${${variable}}"`
}

function posix(command: string, expand: (name: string, quote: Quote) => string) {
  const parts: string[] = []
  let quote: Quote = "none"
  let index = 0
  while (index < command.length) {
    const char = command[index]
    REFERENCE.lastIndex = index
    const match = char === "{" ? REFERENCE.exec(command) : null
    if (match) {
      parts.push(expand(match[1], quote))
      index += match[0].length
      continue
    }
    // An escaped character is copied with its backslash, so `\{vault:name}` stays literal.
    if (char === "\\" && quote !== "single") {
      parts.push(command.slice(index, index + 2))
      index += 2
      continue
    }
    quote = nextQuote(quote, char)
    parts.push(char)
    index++
  }
  return parts.join("")
}

function nextQuote(quote: Quote, char: string): Quote {
  if (quote === "single") return char === "'" ? "none" : "single"
  if (quote === "double") return char === '"' ? "none" : "double"
  if (char === "'") return "single"
  if (char === '"') return "double"
  return "none"
}
