/**
 * What a request to the design surface is asking for.
 *
 * Kept apart from the route so the shape of the surface can be tested without a server: the
 * distinction between "the shell" and "bytes from a model-written directory" is the security
 * boundary, and it should be readable in one place.
 */
export type Target =
  | { readonly kind: "shell"; readonly id: string }
  | { readonly kind: "file"; readonly id: string; readonly path: string }
  | { readonly kind: "revision"; readonly id: string }
  | { readonly kind: "feedback"; readonly id: string }
  /** The live event stream a mounted shell listens to. */
  | { readonly kind: "events"; readonly id: string }
  /** The person ended the review. */
  | { readonly kind: "end"; readonly id: string }
  /** An image attached to a note: upload (no aid), fetch or delete (with one). */
  | { readonly kind: "attachment"; readonly id: string; readonly aid?: string }
  /** A design asset we ship for prototypes that have no network: tailwind, daisyui, mermaid. */
  | { readonly kind: "vendor"; readonly name: string }
  /** A shell is about to load the prototype into its frame, and wants a token for that load. */
  | { readonly kind: "load"; readonly id: string }
  /** One browser pass of the passive layout audit. Never wakes the agent. */
  | { readonly kind: "diagnostics"; readonly id: string }
  /** The layout inbox: read it, prepare a batch of fixes, or dismiss one warning. */
  | { readonly kind: "warnings"; readonly id: string; readonly action?: "queue" | "dismiss" }
  /** The prototype could not be shown at all. The one report that does wake the agent. */
  | { readonly kind: "failures"; readonly id: string }
  /** The prototype as one self-contained file. */
  | { readonly kind: "export"; readonly id: string }
  /** The whiteboard frame page for one diagram. */
  | { readonly kind: "whiteboard-frame"; readonly id: string }
  /** Every diagram's Mermaid source, from the file on disk. */
  | { readonly kind: "mermaid-sources"; readonly id: string }
  /** One diagram's saved scene: read, or write. */
  | { readonly kind: "whiteboard"; readonly id: string; readonly index: number }
  /** A frame proving it was minted for this prototype. */
  | { readonly kind: "whiteboard-channel"; readonly id: string }
  /** The agent-facing files for one diagram's scene. */
  | { readonly kind: "whiteboard-files"; readonly id: string; readonly index: number }
  /** A file of the whiteboard bundle: the script, the stylesheet, a font. */
  | { readonly kind: "whiteboard-asset"; readonly path: string }

const ID = /^[A-Za-z0-9_-]{1,64}$/

const VENDOR = /^\/design\/vendor\/([A-Za-z0-9._-]{1,64})$/

export function parse(pathname: string): Target | undefined {
  if (!pathname.startsWith("/design/")) return undefined
  if (pathname.startsWith("/design/vendor/whiteboard/")) {
    const rest = pathname.slice("/design/vendor/whiteboard/".length)
    return rest ? { kind: "whiteboard-asset", path: rest } : undefined
  }
  const vendor = VENDOR.exec(pathname)
  if (vendor) return { kind: "vendor", name: vendor[1]! }
  const rest = pathname.slice("/design/".length)
  const slash = rest.indexOf("/")
  const id = slash === -1 ? rest : rest.slice(0, slash)
  if (!ID.test(id)) return undefined
  const tail = slash === -1 ? "" : rest.slice(slash)
  if (tail === "" || tail === "/") return { kind: "shell", id }
  if (tail === "/revision") return { kind: "revision", id }
  if (tail === "/feedback") return { kind: "feedback", id }
  if (tail === "/events") return { kind: "events", id }
  if (tail === "/end") return { kind: "end", id }
  if (tail === "/attachments") return { kind: "attachment", id }
  if (tail === "/loads/begin") return { kind: "load", id }
  if (tail === "/layout-diagnostics") return { kind: "diagnostics", id }
  if (tail === "/layout-warnings") return { kind: "warnings", id }
  if (tail === "/layout-warnings/queue") return { kind: "warnings", id, action: "queue" }
  if (tail === "/layout-warnings/dismiss") return { kind: "warnings", id, action: "dismiss" }
  if (tail === "/artifact-failures") return { kind: "failures", id }
  if (tail === "/export") return { kind: "export", id }
  if (tail === "/whiteboard") return { kind: "whiteboard-frame", id }
  if (tail === "/mermaid-sources") return { kind: "mermaid-sources", id }
  if (tail === "/whiteboard-channel") return { kind: "whiteboard-channel", id }
  const scene = /^\/whiteboard\/(\d{1,3})(\/feedback-files)?$/.exec(tail)
  if (scene) {
    const index = Number(scene[1])
    return scene[2] ? { kind: "whiteboard-files", id, index } : { kind: "whiteboard", id, index }
  }
  const attachment = /^\/attachments\/([0-9a-f]{64}\.(?:png|jpg|webp))$/.exec(tail)
  if (attachment) return { kind: "attachment", id, aid: attachment[1]! }
  // The `/files/` prefix is what makes relative asset paths inside a prototype resolve back into
  // the prototype rather than into the surface's own endpoints.
  if (tail.startsWith("/files/")) return { kind: "file", id, path: tail.slice("/files".length) }
  return undefined
}

export * as DesignRoutePath from "./route-path"
