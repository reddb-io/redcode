export * as DesignWaiting from "./design-waiting"

import { DesignAppBinary } from "@opencode/core/design/app-binary"
import { reviewCopy } from "@opencode/core/design/ui/copy"

export const CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

/**
 * The page a review link answers with while this server downloads or starts the design app, instead of
 * a connection error: the stage, the download's progress and the elapsed time. It reloads itself until
 * the app runs and the link redirects there; a failure stays with a Retry link.
 */
export function page(input: {
  readonly progress?: DesignAppBinary.Progress
  readonly error?: string
  readonly now: number
}) {
  const escape = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  const progress = input.progress
  const line =
    input.error !== undefined
      ? reviewCopy.appFailed
      : progress?.phase === "download"
        ? reviewCopy.appDownloading
            .replace("{{version}}", progress.version ?? "")
            .replace("{{progress}}", DesignAppBinary.amount(progress))
        : reviewCopy.appStarting
  const bar =
    input.error !== undefined
      ? ""
      : progress?.phase === "download" && progress.total
        ? `<progress max="100" value="${Math.min(100, Math.round((progress.received / progress.total) * 100))}" aria-label="${escape(line)}"></progress>`
        : `<progress aria-label="${escape(line)}"></progress>`
  const elapsed = progress ? Math.max(0, Math.floor((input.now - progress.started) / 1000)) : undefined
  const detail =
    input.error !== undefined
      ? `<p class="error" role="alert">${escape(input.error)}</p><p><a href="">${escape(reviewCopy.previewRetry)}</a></p>`
      : `<p class="muted">${elapsed === undefined ? "" : `${escape(reviewCopy.loadingElapsed.replace("{{seconds}}", String(elapsed)))} · `}${escape(reviewCopy.appReload)}</p>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${input.error !== undefined ? "" : '<meta http-equiv="refresh" content="1">'}<title>${escape(reviewCopy.appWaiting)} · Redcode</title><style>:root{color-scheme:light dark;--surface:#fafafa;--ink:#1c1c1e;--muted:#6b6b70;--accent:#c8102e;--danger:#b3261e}@media(prefers-color-scheme:dark){:root{--surface:#141416;--ink:#ececef;--muted:#9c9ca3;--accent:#ff5a6e;--danger:#ff8a80}}html,body{height:100%;margin:0}body{display:grid;place-items:center;padding:16px;box-sizing:border-box;background:var(--surface);color:var(--ink);font:14px/1.5 system-ui,sans-serif}main{width:min(420px,100%);display:grid;gap:10px}h1{font-size:16px;margin:0}p{margin:0;overflow-wrap:anywhere}.muted{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}.error{color:var(--danger);white-space:pre-wrap}progress{width:100%;height:6px;accent-color:var(--accent)}a{color:var(--accent)}</style></head><body><main><h1>${escape(reviewCopy.appWaiting)}</h1><p role="status">${escape(line)}</p>${bar}${detail}</main></body></html>`
}
