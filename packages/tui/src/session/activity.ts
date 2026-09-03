/**
 * What the assistant is doing right now, in words.
 *
 * The server only reports `idle | busy | retry`, so a running turn used to show a spinner and
 * nothing else: no way to tell thinking from a shell command from a stalled request. The parts
 * already streaming into the session say exactly what is happening, so the label is derived
 * from them rather than added to the protocol.
 */

export type ActivityPart = {
  type: string
  tool?: string
  text?: string
  state?: {
    status?: string
    input?: Record<string, unknown>
    title?: string
  }
}

const VERBS: Record<string, string> = {
  bash: "Running",
  edit: "Editing",
  write: "Writing",
  apply_patch: "Patching",
  read: "Reading",
  grep: "Searching",
  glob: "Finding files",
  list: "Listing",
  webfetch: "Fetching",
  websearch: "Searching the web",
  task: "Delegating",
  todowrite: "Planning",
  skill: "Loading skill",
  question: "Asking",
  execute: "Executing",
}

// The argument worth naming differs per tool: a path for file tools, the command for a shell.
const SUBJECTS = ["filePath", "path", "pattern", "query", "url", "command", "description", "name"]

function subject(input: Record<string, unknown> | undefined) {
  if (!input) return
  for (const key of SUBJECTS) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return
}

function shorten(value: string, width: number) {
  const single = value.replace(/\s+/g, " ").trim()
  if (single.length <= width) return single
  return single.slice(0, Math.max(1, width - 1)) + "…"
}

/** Paths are long and the tail is the informative half, so keep the tail. */
function tail(value: string, width: number) {
  if (value.length <= width) return value
  return "…" + value.slice(-(width - 1))
}

function describeTool(part: ActivityPart, width: number) {
  const tool = part.tool ?? "tool"
  const verb = VERBS[tool]
  const target = subject(part.state?.input)
  if (!verb) return shorten(part.state?.title ?? tool, width)
  if (!target) return verb
  const looksLikePath = target.includes("/") || target.includes("\\")
  const room = Math.max(8, width - verb.length - 1)
  return `${verb} ${looksLikePath ? tail(target, room) : shorten(target, room)}`
}

/**
 * Never `undefined` while a turn is running: silence is what made a stalled request look the
 * same as a working one. When nothing has come back yet, that fact is itself the answer.
 */
export function describeActivity(parts: readonly ActivityPart[], width = 48): string {
  // The most recent unfinished tool is the most informative thing on screen.
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part.type !== "tool") continue
    const status = part.state?.status
    if (status === "running") return describeTool(part, width)
    if (status === "pending") return "Preparing " + (part.tool ?? "tool")
    break
  }

  const last = [...parts].reverse().find((part) => part.type === "reasoning" || part.type === "text")
  if (last?.type === "reasoning") return "Thinking"
  if (last?.type === "text") return "Responding"
  // A turn with no parts yet is a request the provider has not answered, which is exactly the
  // state that used to show a bare spinner for half an hour.
  return "Waiting for the model"
}
