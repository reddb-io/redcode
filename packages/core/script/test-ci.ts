#!/usr/bin/env bun

// CI entry for the core suite: `bun test` with the given arguments, under a watchdog.
//
// A file that never finishes loading (a top-level await that never settles, or code that blocks
// the event loop) is outside every Bun timeout, and with `--only-failures` a stuck `--parallel`
// run prints nothing at all: CI used to sit silent until the step timeout, then kill the run
// without a word about which file it was in. Here a run that goes quiet for too long, or runs
// past its deadline, is reported and stopped: each worker's current file (recorded by
// test/preload.ts through REDCODE_TEST_PROGRESS), the process tree, and Bun's own list of files
// still running when it is interrupted.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// The whole suite normally finishes in about a minute and a quarter.
const SILENCE_MS = 4 * 60_000
const DEADLINE_MS = 10 * 60_000
// How long Bun gets after SIGTERM to list the files it was still running.
const GRACE_MS = 15_000

const progress = fs.mkdtempSync(path.join(os.tmpdir(), "redcode-core-progress-"))
const started = Date.now()
let heard = started
let stopping: Promise<void> | undefined

const child = Bun.spawn([process.execPath, "test", ...process.argv.slice(2)], {
  stdin: "ignore",
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env, REDCODE_TEST_PROGRESS: progress },
})

// A step timeout or a cancelled job signals this process; Bun then still says what was running.
for (const name of ["SIGINT", "SIGTERM"] as const) process.on(name, () => child.kill(name))

const watchdog = setInterval(() => {
  const now = Date.now()
  const reason =
    now - started > DEADLINE_MS
      ? `still running after ${minutes(now - started)}`
      : now - heard > SILENCE_MS
        ? `no output for ${minutes(now - heard)}`
        : undefined
  if (!reason) return
  clearInterval(watchdog)
  stopping = stall(reason)
}, 5_000)

await Promise.all([forward(child.stdout, process.stdout), forward(child.stderr, process.stderr)])
const code = await child.exited
clearInterval(watchdog)
await stopping
fs.rmSync(progress, { recursive: true, force: true })
process.exit(stopping ? 1 : code)

async function forward(stream: ReadableStream<Uint8Array>, out: NodeJS.WriteStream) {
  for await (const chunk of stream) {
    heard = Date.now()
    out.write(chunk)
  }
}

async function stall(reason: string) {
  const tree = processTree(child.pid)
  console.error(`\n[test-ci] core test run stalled: ${reason}. Stopping it.`)
  const stuck = unfinished()
  console.error("[test-ci] files each worker started and has not finished:")
  console.error(
    stuck
      .map((item) => `  pid ${item.pid}${item.alive ? "" : " (gone)"}: ${item.file} (${item.elapsed}, ${item.test})`)
      .join("\n") ||
      "  (none recorded)",
  )
  if (tree.length) console.error(`[test-ci] process tree:\n${tree.map((row) => `  ${row.line}`).join("\n")}`)
  for (const item of stuck.filter((item) => item.alive)) console.error(threads(item.pid))
  // Bun answers SIGTERM with the files it was still running; wait for that before forcing it.
  child.kill("SIGTERM")
  const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(GRACE_MS).then(() => false)])
  if (!exited) console.error(`[test-ci] bun test ignored SIGTERM for ${GRACE_MS / 1000}s; killing it.`)
  // Workers and whatever they spawned outlive the runner otherwise. The temp-root reapers are left
  // alone: they exist to clean up after exactly this kind of exit.
  for (const row of tree) {
    if (!row.line.includes("temp-root")) signal(row.pid, "SIGKILL")
  }
}

/** Every worker whose last recorded file never finished. */
function unfinished() {
  return fs.readdirSync(progress).flatMap((name) => {
    const lines = fs.readFileSync(path.join(progress, name), "utf8").trim().split("\n")
    const start = lines.findLastIndex((line) => line.startsWith("start "))
    if (start === -1 || lines.slice(start).some((line) => line.startsWith("end "))) return []
    const fields = lines[start]!.split(" ")
    const last = lines.at(-1)!
    const pid = Number(name)
    return [
      {
        pid,
        alive: processAlive(pid),
        file: fields.slice(2).join(" "),
        elapsed: minutes(Date.now() - Number(fields[1])),
        test: last === lines[start] ? "no test started" : `test ${last.split(" ").slice(2).join(" ")}`,
      },
    ]
  })
}

/**
 * A stuck worker's threads (which one is spinning) and, where gdb is installed, their native
 * stacks: a main thread draining microtasks forever looks different from one blocked in a syscall.
 */
function threads(pid: number) {
  if (process.platform !== "linux") return ""
  const text = (command: string[], timeout: number) =>
    Bun.spawnSync(command, { timeout, stderr: "pipe" }).stdout.toString().trim()
  const list = text(["ps", "-L", "-o", "tid=,stat=,pcpu=,time=,comm=", "-p", String(pid)], 10_000)
  const stacks = Bun.which("gdb")
    ? text(["gdb", "-p", String(pid), "-batch", "-nx", "-ex", "thread apply all bt 40"], 90_000)
    : "(gdb not installed)"
  return `[test-ci] threads of ${pid}:\n${list}\n[test-ci] native stacks of ${pid}:\n${stacks}`
}

/** The runner and its descendants, with state and wait channel; empty where `ps` is unavailable. */
function processTree(root: number) {
  if (process.platform === "win32") return []
  const ps = Bun.spawnSync(["ps", "-eo", "pid=,ppid=,etime=,stat=,wchan=,args="], { timeout: 10_000 })
  const rows = ps.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(/\s+/)
      return { pid: Number(fields[0]), ppid: Number(fields[1]), line }
    })
  const found = new Set([root])
  // Parents precede children in pid order only by accident, so repeat until nothing is added.
  for (let size = 0; size !== found.size; ) {
    size = found.size
    for (const row of rows) if (found.has(row.ppid)) found.add(row.pid)
  }
  return rows.filter((row) => found.has(row.pid))
}

function processAlive(pid: number) {
  return Number.isInteger(pid) && pid > 0 && signal(pid, 0)
}

/** Whether the signal was delivered; a process that is already gone is not an error here. */
function signal(pid: number, value: NodeJS.Signals | 0) {
  try {
    process.kill(pid, value)
    return true
  } catch {
    return false
  }
}

function minutes(ms: number) {
  return `${(ms / 60_000).toFixed(1)} min`
}
