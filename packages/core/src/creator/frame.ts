export * as CreatorFrame from "./frame.js"

/** Instrument the isolated Design document before any artifact scripts run. The host remains outside this runtime. */
export function html(source: string) {
  const policy = /<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(source)
  if (!policy || /<script\b/i.test(source.slice(0, policy.index)))
    throw new Error("Creator preview requires the Design content security policy before its scripts")
  const position = policy.index + policy[0].length
  const bootstrap = `(${runtime.toString()})()`.replace(/<\/script/gi, "<\\/script")
  return `${source.slice(0, position)}<script>${bootstrap}</script>${source.slice(position)}`
}

function runtime() {
  const send = (message: string, reason: unknown) => {
    const stack = reason instanceof Error ? reason.stack : undefined
    window.parent.postMessage({ type: "redcode:creator-error", message, ...(stack ? { stack } : {}) }, "*")
  }
  window.addEventListener("error", (event) =>
    send(event.message || "Creator component resource failed to load", event.error),
  )
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason
    send(
      reason instanceof Error
        ? reason.message || reason.name
        : typeof reason === "string"
          ? reason
          : "Unhandled rejection in Creator component",
      reason,
    )
  })
}
