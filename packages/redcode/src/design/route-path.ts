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

const ID = /^[A-Za-z0-9_-]{1,64}$/

const VENDOR = /^\/design\/vendor\/([A-Za-z0-9._-]{1,64})$/

export function parse(pathname: string): Target | undefined {
  if (!pathname.startsWith("/design/")) return undefined
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
  const attachment = /^\/attachments\/([0-9a-f]{64}\.(?:png|jpg|webp))$/.exec(tail)
  if (attachment) return { kind: "attachment", id, aid: attachment[1]! }
  // The `/files/` prefix is what makes relative asset paths inside a prototype resolve back into
  // the prototype rather than into the surface's own endpoints.
  if (tail.startsWith("/files/")) return { kind: "file", id, path: tail.slice("/files".length) }
  return undefined
}

export * as DesignRoutePath from "./route-path"
