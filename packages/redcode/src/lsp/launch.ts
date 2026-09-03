import type { ChildProcessWithoutNullStreams } from "child_process"
import { Process } from "@/util/process"

type Child = Process.Child & ChildProcessWithoutNullStreams

/**
 * Node refuses some command-line flags when they arrive through NODE_OPTIONS, and it refuses
 * them by exiting immediately. A language server started from a shell that exports one — the
 * flag is meant for the user's own Node, not for ours — dies during initialization with a
 * message naming the flag. Nothing about that is the server's fault or ours, so instead of
 * reporting it as a broken server, the flag is dropped for every later spawn.
 */
const rejectedNodeOptions = new Set<string>()

const REJECTED = /(--[\w-]+)\s+is not allowed in NODE_OPTIONS/i

/** Records the flag a failing server named, and says whether it is worth spawning again. */
export function noteRejectedNodeOption(reason: unknown) {
  const text = reason instanceof Error ? `${reason.message}` : String(reason ?? "")
  const flag = text.match(REJECTED)?.[1]
  if (!flag || rejectedNodeOptions.has(flag)) return false
  rejectedNodeOptions.add(flag)
  return true
}

/** Only the flags this environment has proven a server cannot take are removed. */
export function nodeOptionsWithoutRejected(value: string | undefined) {
  if (!value) return value
  if (rejectedNodeOptions.size === 0) return value
  const kept = value.split(/\s+/).filter((entry) => entry && !rejectedNodeOptions.has(entry))
  return kept.join(" ")
}

export function spawn(cmd: string, args: string[], opts?: Process.Options): Child
export function spawn(cmd: string, opts?: Process.Options): Child
export function spawn(cmd: string, argsOrOpts?: string[] | Process.Options, opts?: Process.Options) {
  const args = Array.isArray(argsOrOpts) ? [...argsOrOpts] : []
  const cfg = Array.isArray(argsOrOpts) ? opts : argsOrOpts
  const inherited = cfg?.env === null ? undefined : (cfg?.env?.["NODE_OPTIONS"] ?? process.env["NODE_OPTIONS"])
  const sanitized = nodeOptionsWithoutRejected(inherited)
  const proc = Process.spawn([cmd, ...args], {
    ...cfg,
    ...(cfg?.env === null || sanitized === inherited ? {} : { env: { ...cfg?.env, NODE_OPTIONS: sanitized ?? "" } }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  }) as Child

  if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")

  return proc
}
