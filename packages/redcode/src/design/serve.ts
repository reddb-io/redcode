import path from "path"
import { DIR as STATE_DIR } from "./state"

/**
 * What may be served out of a prototype directory, and under what policy.
 *
 * The directory is written by the model, sits inside the user's worktree, and is reachable over
 * HTTP. Two things follow: the resolver must not be talked out of the directory, and the document
 * must not be able to reach anything once it loads.
 */

/** Enough to build with; nothing that executes off-document or reads the filesystem. */
const SERVABLE = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".map", "application/json; charset=utf-8"],
])

/** A prototype is a page, not a payload. Well above any honest asset, well below a memory problem. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024

export function mimeFor(file: string): string | undefined {
  return SERVABLE.get(path.extname(file).toLowerCase())
}

/**
 * Resolve a request path inside the prototype directory, or refuse.
 *
 * Refusal rather than a guess: an unservable extension, a traversal, or an absolute path returns
 * undefined, which the route answers as 404. That also keeps `.env` and `.git` out without naming
 * them, because they are simply not on the list.
 */
export function resolve(root: string, requestPath: string): string | undefined {
  const decoded = (() => {
    try {
      return decodeURIComponent(requestPath)
    } catch {
      return undefined
    }
  })()
  if (decoded === undefined) return undefined
  // A NUL byte truncates the path for some syscalls while surviving a prefix check.
  if (decoded.includes("\0")) return undefined
  const relative = decoded.replace(/^\/+/, "")
  if (!relative || relative.endsWith("/")) return undefined
  if (path.isAbsolute(relative)) return undefined
  const target = path.resolve(root, relative)
  const base = path.resolve(root)
  if (target !== base && !target.startsWith(base + path.sep)) return undefined
  // The review's own state lives beside the prototype and is never part of it.
  if (path.relative(base, target).split(path.sep)[0] === STATE_DIR) return undefined
  if (!mimeFor(target)) return undefined
  return target
}

/**
 * The policy the prototype document carries.
 *
 * `sandbox` as a *header* directive rather than only an iframe attribute, so the document is
 * opaque-origin even when someone opens its URL directly. At an opaque origin `'self'` matches
 * nothing, so inline is the only script mode that can work — which suits model-generated HTML,
 * and is harmless precisely because `connect-src 'none'` means the code it runs can reach nothing.
 */
export function prototypeCSP(input: { assets: string }) {
  return [
    "sandbox allow-scripts allow-forms allow-modals allow-popups",
    "default-src 'none'",
    `script-src 'unsafe-inline' blob: ${input.assets}`,
    `style-src 'unsafe-inline' ${input.assets}`,
    `img-src data: blob: ${input.assets}`,
    `font-src data: ${input.assets}`,
    `media-src data: blob: ${input.assets}`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join("; ")
}

export * as DesignServe from "./serve"
