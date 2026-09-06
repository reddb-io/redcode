/**
 * What the prototype gets, and nothing more.
 *
 * Injected into every HTML document served from a prototype directory: one script, built from the
 * source of the functions in `client/`. Serving adds this tag and changes nothing else, so the
 * document stays byte-identical to the file on disk and renders the same when opened directly.
 *
 * The bundle is assembled from `Function.prototype.toString` rather than a build step, so it ships
 * inside the binary, is typechecked and unit-tested as ordinary TypeScript, and cannot drift from
 * the route that serves it. The helpers are declared by name in one scope — they call each other —
 * and the main function receives them as a table, so nothing in it depends on a name surviving.
 */

import { artifactMain, type ArtifactConfig } from "./client/artifact"
import { HELPERS } from "./client/helpers"

/** A readable name for an element, short enough to sit in a transcript line. */
export const LABEL_PARTS = 3

export function sdkScript(config: ArtifactConfig = { load: 0 }) {
  const declarations = HELPERS.map((fn) => fn.toString()).join("\n")
  const table = "{ " + HELPERS.map((fn) => fn.name + ": " + fn.name).join(", ") + " }"
  return `(() => {
${declarations}
;(${artifactMain.toString()})(${JSON.stringify(config)}, ${table})
})()`
}

/** Put the SDK in the document without disturbing what the model wrote. */
export function injectSDK(html: string, config: ArtifactConfig = { load: 0 }) {
  const script = `<script>${sdkScript(config)}</script>`
  const head = html.match(/<head\b[^>]*>/i)
  if (head?.index !== undefined) {
    const at = head.index + head[0].length
    return html.slice(0, at) + script + html.slice(at)
  }
  const body = html.match(/<body\b[^>]*>/i)
  if (body?.index !== undefined) {
    const at = body.index + body[0].length
    return html.slice(0, at) + script + html.slice(at)
  }
  return script + html
}

export * as DesignSDK from "./sdk"
