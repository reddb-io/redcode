declare global {
  const REDCODE_WORKER_PATH: string
}

export async function workerPath() {
  if (typeof REDCODE_WORKER_PATH !== "undefined") return REDCODE_WORKER_PATH
  const dist = new URL("./cli/tui/worker.js", import.meta.url)
  if (await Bun.file(dist).exists()) return dist
  return new URL("./tui/worker.ts", import.meta.url)
}
