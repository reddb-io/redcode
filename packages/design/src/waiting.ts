import type { ReviewCopy } from "./copy"

/** How far redcode got with the design app while a review link waits for it. */
export interface Waiting {
  readonly phase: "download" | "start" | "failed"
  readonly version?: string
  /** What arrived so far, such as "45%" or "3.2 MB". */
  readonly amount?: string
  /** 0 to 100 when the download's size is known. */
  readonly percent?: number
  /** Seconds since the download or start began. */
  readonly elapsed?: number
  readonly message?: string
}

export const WAITING_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

/**
 * The page a review link answers with while redcode downloads or starts the design app, instead of a
 * connection error: the stage, the download's progress and the elapsed time. It reloads itself until
 * the app runs and the link redirects there; a failure stays with a Retry link.
 */
export function designWaiting(copy: ReviewCopy, waiting: Waiting) {
  const escape = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  const line =
    waiting.phase === "failed"
      ? copy.appFailed
      : waiting.phase === "download"
        ? copy.appDownloading
            .replace("{{version}}", waiting.version ?? "")
            .replace("{{progress}}", waiting.amount ?? "")
        : copy.appStarting
  const bar =
    waiting.phase === "failed"
      ? ""
      : waiting.percent === undefined
        ? `<progress aria-label="${escape(line)}"></progress>`
        : `<progress max="100" value="${Math.round(waiting.percent)}" aria-label="${escape(line)}"></progress>`
  const detail =
    waiting.phase === "failed"
      ? `<p class="error" role="alert">${escape(waiting.message ?? "")}</p><p><a href="">${escape(copy.previewRetry)}</a></p>`
      : `<p class="muted">${waiting.elapsed === undefined ? "" : `${escape(copy.loadingElapsed.replace("{{seconds}}", String(waiting.elapsed)))} · `}${escape(copy.appReload)}</p>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${waiting.phase === "failed" ? "" : '<meta http-equiv="refresh" content="1">'}<title>${escape(copy.appWaiting)} · Redcode</title><style>:root{color-scheme:light dark;--surface:#fafafa;--ink:#1c1c1e;--muted:#6b6b70;--edge:#dedee3;--accent:#c8102e;--danger:#b3261e}@media(prefers-color-scheme:dark){:root{--surface:#141416;--ink:#ececef;--muted:#9c9ca3;--edge:#2c2c31;--accent:#ff5a6e;--danger:#ff8a80}}html,body{height:100%;margin:0}body{display:grid;place-items:center;padding:16px;box-sizing:border-box;background:var(--surface);color:var(--ink);font:14px/1.5 system-ui,sans-serif}main{width:min(420px,100%);display:grid;gap:10px}h1{font-size:16px;margin:0}p{margin:0;overflow-wrap:anywhere}.muted{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}.error{color:var(--danger);white-space:pre-wrap}progress{width:100%;height:6px;accent-color:var(--accent)}a{color:var(--accent)}</style></head><body><main><h1>${escape(copy.appWaiting)}</h1><p role="status">${escape(line)}</p>${bar}${detail}</main></body></html>`
}
