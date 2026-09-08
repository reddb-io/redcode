/** Untrusted frame sends descriptive data only. It never receives host credentials. */
export function annotations() {
  const state = { enabled: false }
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return
    if (event.data?.type === "design:annotate") state.enabled = event.data.enabled === true
    if (
      event.data?.type === "design:tweak" &&
      /^--[a-zA-Z][a-zA-Z0-9-]*$/.test(event.data.key) &&
      typeof event.data.value === "string" &&
      /^[^;{}<>]*$/.test(event.data.value)
    )
      document.documentElement.style.setProperty(event.data.key, event.data.value)
  })
  document.addEventListener(
    "click",
    (event) => {
      if (!state.enabled || !(event.target instanceof Element)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const target =
        event.target.closest("[data-mermaid-source], [data-mermaid], .mermaid") ??
        event.target.closest("[data-design-id], [id], button, a, input, table, svg") ??
        event.target
      const ancestry = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`
        if (!element.parentElement || element === document.body) return element.tagName.toLowerCase()
        return `${ancestry(element.parentElement)} > ${element.tagName.toLowerCase()}:nth-child(${Array.from(element.parentElement.children).indexOf(element) + 1})`
      }
      const selector = target.id
        ? `#${CSS.escape(target.id)}`
        : target.hasAttribute("data-design-id")
          ? `[data-design-id="${CSS.escape(target.getAttribute("data-design-id")!)}"]`
          : ancestry(target)
      parent.postMessage(
        {
          type: "design:selection",
          target: selector,
          text:
            target.getAttribute("data-mermaid-source") || window.getSelection()?.toString() || target.textContent || "",
          snapshot: document.body.innerText,
        },
        "*",
      )
    },
    true,
  )
  const audit = () => {
    const findings = [...document.querySelectorAll("button, input, select, textarea, h1, h2, p")].flatMap((element) => {
      const box = element.getBoundingClientRect()
      if (!box.width || !box.height) return []
      if (box.right > innerWidth + 1 || box.left < -1)
        return [
          {
            target: element.id ? `#${CSS.escape(element.id)}` : element.tagName.toLowerCase(),
            text: "Element extends beyond the viewport",
          },
        ]
      return []
    })
    parent.postMessage({ type: "design:layout", findings }, "*")
  }
  void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(audit)))
  const resize = new ResizeObserver(() => requestAnimationFrame(audit))
  resize.observe(document.documentElement)
}
