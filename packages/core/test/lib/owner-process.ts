import path from "node:path"
import { Effect } from "effect"

/** A real independent runtime, killed without releasing its durable execution claim. */
export const ownerProcess = Effect.fn(function* (database: string, sessionID: string) {
  const child = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/session-owner.ts"), database, sessionID], {
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      }),
    ),
    (process) =>
      Effect.promise(async () => {
        process.kill()
        await process.exited
      }),
  )
  yield* Effect.promise(async () => {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let text = ""
    while (!text.includes("SESSION_OWNER_READY\n")) {
      const next = await reader.read()
      if (next.done) throw new Error(`Owner fixture exited: ${await new Response(child.stderr).text()}`)
      text += decoder.decode(next.value, { stream: true })
    }
    reader.releaseLock()
  }).pipe(Effect.timeout("15 seconds"))
  return {
    pid: child.pid,
    stop: Effect.promise(async () => {
      child.kill()
      await child.exited
    }),
  }
})
