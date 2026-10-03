/** Serialized into the sandbox. The host asks for the current viewport, never a rebuilt revision. */
export function capture(
  rasterize: (
    element: HTMLElement,
    options: {
      width: number
      height: number
      scale: number
      copyDefaultStyles: boolean
      preserveScroll: boolean
      adjustClonedNode: (original: Node, clone: Node, after: boolean) => void
      onclone: (element: HTMLElement) => void
    },
  ) => Promise<HTMLCanvasElement>,
  revision: string,
) {
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.type !== "design:capture" || typeof event.data.request !== "string")
      return
    const request = event.data.request
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden"
    }
    const variant = [...document.querySelectorAll<HTMLElement>("[data-design-variant]")].find(visible)
    const screen = [...(variant ?? document).querySelectorAll<HTMLElement>("[data-design-screen]")].find(visible)
    const view = {
      revision,
      variant: variant?.dataset.designVariant ?? "",
      screen: screen?.dataset.designScreen ?? "",
      width: innerWidth,
      height: innerHeight,
      scrollX,
      scrollY,
    }
    const fixed: { clone: HTMLElement; x: number; y: number }[] = []
    const fail = (error: unknown) =>
      parent.postMessage(
        {
          type: "design:capture-result",
          request,
          error: true,
          reason: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
        },
        "*",
      )
    void Promise.resolve()
      .then(() =>
        rasterize(document.documentElement, {
          width: view.width,
          height: view.height,
          scale: Math.min(1, 1600 / Math.max(view.width, view.height)),
          // Copy computed styles directly: a default-style helper iframe cannot share the opaque sandbox origin.
          copyDefaultStyles: false,
          preserveScroll: true,
          adjustClonedNode: (original, clone, after) => {
            if (
              after ||
              !(original instanceof HTMLElement) ||
              !(clone instanceof HTMLElement) ||
              getComputedStyle(original).position !== "fixed" ||
              original.offsetParent
            )
              return
            const rect = original.getBoundingClientRect()
            fixed.push({
              clone,
              x: rect.x + view.scrollX - document.body.offsetLeft,
              y: rect.y + view.scrollY - document.body.offsetTop,
            })
          },
          onclone: (element) => {
            // Restoring root scroll gives the cloned body a transform; keep viewport-fixed controls in their visible positions.
            for (const item of fixed) {
              item.clone.style.left = `${item.x}px`
              item.clone.style.top = `${item.y}px`
              item.clone.style.right = "auto"
              item.clone.style.bottom = "auto"
            }
            // Preserve the review's existing rule: passwords, payment fields and file paths never leave the frame.
            for (const field of element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
              "input[type=password],input[type=file],[autocomplete*='cc-']",
            )) {
              field.value = ""
              field.removeAttribute("value")
            }
            for (const node of element.querySelectorAll("[data-design-highlight],[data-design-reveal]")) {
              node.removeAttribute("data-design-highlight")
              node.removeAttribute("data-design-reveal")
            }
          },
        }),
      )
      .then((canvas) => {
        const data = canvas.toDataURL("image/png")
        parent.postMessage({ type: "design:capture-result", request, ...view, data }, "*")
      }, fail)
      .catch(fail)
  })
}
