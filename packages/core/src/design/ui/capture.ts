/** Serialized into the sandbox. The host asks for the current viewport, never a rebuilt revision. */
export function capture(
  rasterize: (
    element: HTMLElement,
    options: {
      width: number
      height: number
      x: number
      y: number
      scale: number
      logging: boolean
      allowTaint: boolean
      onclone: (document: Document) => void
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
    void Promise.resolve()
      .then(() =>
        rasterize(document.documentElement, {
          width: view.width,
          height: view.height,
          x: view.scrollX,
          y: view.scrollY,
          scale: Math.min(1, 1600 / Math.max(view.width, view.height)),
          logging: false,
          allowTaint: false,
          onclone: (document) => {
            // Preserve the review's existing rule: passwords, payment fields and file paths never leave the frame.
            for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
              "input[type=password],input[type=file],[autocomplete*='cc-']",
            )) {
              field.value = ""
              field.removeAttribute("value")
            }
            for (const element of document.querySelectorAll("[data-design-highlight],[data-design-reveal]")) {
              element.removeAttribute("data-design-highlight")
              element.removeAttribute("data-design-reveal")
            }
          },
        }),
      )
      .then(
        (canvas) => {
          const data = canvas.toDataURL("image/png")
          parent.postMessage({ type: "design:capture-result", request, ...view, data }, "*")
        },
        () => parent.postMessage({ type: "design:capture-result", request, error: true }, "*"),
      )
      .catch(() => parent.postMessage({ type: "design:capture-result", request, error: true }, "*"))
  })
}
