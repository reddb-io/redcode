import { appearance } from "@reddb-io/redcode-design/brand.gen"
import { createResource, onCleanup } from "solid-js"
import { reviewCopy, type ReviewCopy } from "@reddb-io/redcode-design/copy"
import type { mountReview, ReviewOptions } from "@reddb-io/redcode-design/review"

/** Keep lazy module resolution inside the owner while tracking translated copy synchronously. */
export function createSessionDesignMount(input: {
  root: HTMLElement
  load: () => Promise<{ mountReview: typeof mountReview }>
  options: () => Omit<ReviewOptions, "copy"> | undefined
  /** Holds the open panel as a connected review page until the signal aborts (the panel unmounts). */
  presence?: (options: Omit<ReviewOptions, "copy">, signal: AbortSignal) => void
}) {
  const [studio] = createResource(input.load)
  createEffect(() => {
    const module = studio()
    const options = input.options()
    if (!module || !options) return
    const host = document.createElement("div")
    host.style.height = "100%"
    input.root.replaceChildren(host)
    // The session page sends typed letters to the prompt, so the review's shortcuts stay scoped to it.
    const mounted = module.mountReview(host, { ...options, shortcuts: "scoped", copy: reviewCopy, appearance })
    onCleanup(mounted)
    const presence = new AbortController()
    onCleanup(() => presence.abort())
    input.presence?.(options, presence.signal)
  })
}
