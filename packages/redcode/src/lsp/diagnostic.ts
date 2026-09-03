import * as LSPClient from "./client"

const MAX_PER_FILE = 20

export function pretty(diagnostic: LSPClient.Diagnostic) {
  const severityMap = {
    1: "ERROR",
    2: "WARN",
    3: "INFO",
    4: "HINT",
  }

  const severity = severityMap[diagnostic.severity || 1]
  const line = diagnostic.range.start.line + 1
  const col = diagnostic.range.start.character + 1

  return `${severity} [${line}:${col}] ${diagnostic.message}`
}

// LSP.diagnostics() answers with every file every client has ever opened, which on a large
// workspace is tens of megabytes. Tool metadata is cloned, written to the durable store and
// pushed to every client on each edit, and every reader of it looks up one file — so only the
// files the tool touched belong in there.
export function pick(diagnostics: Record<string, LSPClient.Diagnostic[]>, files: string[]) {
  const result: Record<string, LSPClient.Diagnostic[]> = {}
  for (const file of files) {
    const hit = diagnostics[file]
    if (hit) result[file] = hit
  }
  return result
}

export function report(file: string, issues: LSPClient.Diagnostic[]) {
  const errors = issues.filter((item) => item.severity === 1)
  if (errors.length === 0) return ""
  const limited = errors.slice(0, MAX_PER_FILE)
  const more = errors.length - MAX_PER_FILE
  const suffix = more > 0 ? `\n... and ${more} more` : ""
  return `<diagnostics file="${file}">\n${limited.map(pretty).join("\n")}${suffix}\n</diagnostics>`
}

export * as Diagnostic from "./diagnostic"
