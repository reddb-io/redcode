import { FileDiff } from "@opencode/schema/file-diff"
import { formatPatch, structuredPatch } from "diff"

export function fileDiff(
  file: string,
  before: string,
  after: string,
  status: typeof FileDiff.Info.Type.status = "modified",
): typeof FileDiff.Info.Type {
  if (before === "" || after === "") {
    const header = `Index: ${file}\n${"=".repeat(67)}\n--- ${file}\n+++ ${file}\n`
    const text = before || after
    if (text === "") return { file, patch: header, status, additions: 0, deletions: 0 }
    const added = before === ""
    const sign = added ? "+" : "-"
    const finalNewline = text.endsWith("\n")
    const body = finalNewline ? text.slice(0, -1) : text
    let count = 1
    for (let index = body.indexOf("\n"); index !== -1; index = body.indexOf("\n", index + 1)) count++
    const range = added ? `@@ -0,0 +1,${count} @@` : `@@ -1,${count} +0,0 @@`
    const marker = finalNewline ? "" : "\\ No newline at end of file\n"
    return {
      file,
      patch: `${header}${range}\n${sign}${body.replaceAll("\n", `\n${sign}`)}\n${marker}`,
      status,
      additions: added ? count : 0,
      deletions: added ? 0 : count,
    }
  }
  const change = structuredPatch(file, file, before, after)
  let additions = 0
  let deletions = 0
  for (const hunk of change.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) additions++
      if (line.startsWith("-")) deletions++
    }
  }
  return {
    file,
    patch: formatPatch(change),
    status,
    additions,
    deletions,
  }
}
