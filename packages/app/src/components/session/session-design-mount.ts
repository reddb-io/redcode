import { appearance } from "@reddb-io/redcode-design/brand.gen"
import { createEffect, createMemo, createResource, onCleanup, untrack } from "solid-js"
import { reviewCopy, type ReviewCopy } from "@reddb-io/redcode-design/copy"
import type { mountReview, ReviewOptions } from "@reddb-io/redcode-design/review"

/** Keep lazy module resolution inside the owner while tracking translated copy synchronously. */
export function createSessionDesignMount(input: {
  root: HTMLElement
  load: () => Promise<{ mountReview: typeof mountReview }>
  options: () => Omit<ReviewOptions, "copy"> | undefined
  translate: (key: `session.design.studio.${keyof ReviewCopy}`) => string
}) {
  const [studio] = createResource(input.load)
  const keys = Object.keys(reviewCopy) as (keyof ReviewCopy)[]
  const copy = createMemo(
    () => Object.fromEntries(keys.map((key) => [key, input.translate(`session.design.studio.${key}`)])) as ReviewCopy,
    undefined,
    { equals: (previous, next) => keys.every((key) => previous[key] === next[key]) },
  )
  createEffect(() => {
    const module = studio()
    const options = input.options()
    if (!module || !options) return
    const host = document.createElement("div")
    host.style.height = "100%"
    input.root.replaceChildren(host)
    const mounted = module.mountReview(host, { ...options, copy: untrack(copy), appearance })
    onCleanup(mounted)
    createEffect(() => mounted.updateCopy(copy()))
  })
}
