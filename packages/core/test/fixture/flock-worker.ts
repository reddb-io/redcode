import fs from "fs/promises"
import { Flock } from "@reddb-io/redcode-core/util/flock"

type Msg = {
  key: string
  dir: string
  staleMs?: number
  timeoutMs?: number
  baseDelayMs?: number
  maxDelayMs?: number
  holdMs?: number
  ready?: string
  done?: string
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function input() {
  const raw = process.argv[2]
  if (!raw) {
    throw new Error("Missing flock worker input")
  }

  return JSON.parse(raw) as Msg
}

async function job(input: Msg) {
  if (input.ready) {
    await fs.writeFile(input.ready, String(process.pid))
  }

  // Each holder brackets its critical section in the shared journal: mutual exclusion holds
  // exactly when no other holder's line lands between a start and its end. A marker file created
  // and deleted by each holder cannot prove this on Windows, where a deleted name stays reserved
  // while another process still has it open and the next holder's exclusive create then fails.
  if (input.done) {
    await fs.appendFile(input.done, `start ${process.pid}\n`)
  }

  if (input.holdMs && input.holdMs > 0) {
    await sleep(input.holdMs)
  }

  if (input.done) {
    await fs.appendFile(input.done, `end ${process.pid}\n`)
  }
}

async function main() {
  const msg = input()

  await Flock.withLock(msg.key, () => job(msg), {
    dir: msg.dir,
    staleMs: msg.staleMs,
    timeoutMs: msg.timeoutMs,
    baseDelayMs: msg.baseDelayMs,
    maxDelayMs: msg.maxDelayMs,
  })
}

await main().catch((err) => {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err)
  process.stderr.write(text)
  process.exit(1)
})
