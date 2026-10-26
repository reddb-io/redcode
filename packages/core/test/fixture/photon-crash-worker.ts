import { parentPort } from "node:worker_threads"

parentPort?.on("message", () => {
  throw new Error("fixture wasm panic")
})
parentPort?.postMessage({ _tag: "Ready" })
