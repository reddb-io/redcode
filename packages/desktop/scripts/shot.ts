#!/usr/bin/env bun
// Development helper: drives a running `bun run dev` window over the Chrome DevTools Protocol.
//   bun scripts/shot.ts <port> <out.png> [--eval "<js>"] [--width 1280 --height 800] [--click "<css selector>"]
// Prints the result of --eval as JSON, then writes a screenshot of the page.
const [port = "9222", out = "shot.png"] = process.argv.slice(2)
const flag = (name: string) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
  type: string
  webSocketDebuggerUrl: string
}[]
const page = targets.find((target) => target.type === "page")
if (!page) throw new Error(`No page target on port ${port}`)
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => (ws.onopen = resolve))

let id = 0
const pending = new Map<number, (value: any) => void>()
ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data))
  pending.get(message.id)?.(message.result ?? message.error)
}
// A call that navigates (e.g. `location.reload()`) never answers, so every call gives up after 10 seconds.
const call = (method: string, params: object = {}) =>
  new Promise<any>((resolve) => {
    const next = ++id
    pending.set(next, resolve)
    ws.send(JSON.stringify({ id: next, method, params }))
    setTimeout(() => resolve({}), 10_000)
  })
const evaluate = (expression: string) =>
  call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })

const width = flag("width")
const height = flag("height")
if (width && height)
  await call("Emulation.setDeviceMetricsOverride", {
    width: +width,
    height: +height,
    deviceScaleFactor: 1,
    mobile: false,
  })
const click = flag("click")
if (click) {
  await evaluate(`document.querySelector(${JSON.stringify(click)})?.click()`)
  await Bun.sleep(600)
}
const expression = flag("eval")
if (expression) console.log(JSON.stringify((await evaluate(expression)).result?.value))
await Bun.write(out, Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64"))
ws.close()
