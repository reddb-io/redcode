import { FileDiff } from "@opencode/schema/file-diff"
import { formatPatch, structuredPatch } from "diff"

export function fileDiff(
  file: string,
  before: string,
  after: string,
  status: typeof FileDiff.Info.Type.status = "modified",
): typeof FileDiff.Info.Type {
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
