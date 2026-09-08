export * as LSPLaunch from "./launch"

import type { ChildProcessWithoutNullStreams } from "child_process"
import { AsyncLocalStorage } from "node:async_hooks"
import { Process } from "@/util/process"

type Child = Process.Child & ChildProcessWithoutNullStreams

// Rejections belong to one server startup, including its bounded retries. Another
// server can use a different Node version and must retain its own environment.
const recovery = new AsyncLocalStorage<Set<string>>()
const REJECTED = /(--[\w-]+)\s+is not allowed in NODE_OPTIONS/i

export function recover<A>(
  start: () => Promise<A>,
  reason = (error: unknown) => (error instanceof Error ? error.message : String(error ?? "")),
): Promise<A> {
  return recovery.run(new Set(), async () => {
    const rejected = recovery.getStore()!
    const attempt = async (): Promise<A> =>
      start().catch((error: unknown) => {
        const flag = reason(error).match(REJECTED)?.[1]
        if (!flag || rejected.has(flag) || rejected.size >= 4) throw error
        rejected.add(flag)
        return attempt()
      })
    return attempt()
  })
}

/** Preserve quoted values and remove only options rejected by this startup. */
export function nodeOptionsWithoutRejected(value: string | undefined, rejected = recovery.getStore()) {
  if (!value || !rejected?.size) return value
  return value
    .replace(/(?:[^\s"\\]|\\.|"(?:[^"\\]|\\.)*")+/g, (raw) => {
      const token = raw.replace(/"/g, "").replace(/\\(.)/g, "$1")
      return rejected.has(token.split("=", 1)[0]) ? "" : raw
    })
    .trim()
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
