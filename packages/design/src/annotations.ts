/** Untrusted frame sends descriptive data only. It never receives host credentials. */
export function annotations() {
  const state = { enabled: false, variant: "", manifest: "" }
  const style = document.createElement("style")
  document.head.append(style)
  const variants = () =>
    [...document.querySelectorAll<HTMLElement>("[data-design-variant]")]
      .filter((node) => !node.parentElement?.closest("[data-design-variant]"))
      .filter((node) => /^[a-zA-Z0-9_-]{1,64}$/.test(node.dataset.designVariant ?? ""))
  const selectVariant = (id: string) => {
    if (!variants().some((node) => node.dataset.designVariant === id)) return
    state.variant = id
    style.textContent = variants()
      .filter((node) => node.dataset.designVariant !== id)
      .map((node) => `[data-design-variant="${node.dataset.designVariant}"]{display:none!important}`)
      .join("\n")
  }
  const announce = () => {
    const items = variants().map((node) => ({
      id: node.dataset.designVariant!,
      name: (node.dataset.designLabel || node.dataset.designVariant!).slice(0, 100),
    }))
    const manifest = JSON.stringify(items)
    if (manifest === state.manifest) return
    state.manifest = manifest
    selectVariant(items.some((item) => item.id === state.variant) ? state.variant : (items[0]?.id ?? ""))
    parent.postMessage({ type: "design:variants", variants: items }, "*")
  }
  announce()
  new MutationObserver(announce).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-design-variant", "data-design-label"],
  })
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return
    if (event.data?.type === "design:annotate") state.enabled = event.data.enabled === true
    if (event.data?.type === "design:variant" && typeof event.data.id === "string") selectVariant(event.data.id)
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
      const selectedText = window.getSelection()?.toString() ?? ""
      const elementText = (target instanceof HTMLElement ? target.innerText : target.textContent) ?? ""
      parent.postMessage(
        {
          type: "design:selection",
          target: state.variant ? `variant:${state.variant} ${selector}` : selector,
          text: target.getAttribute("data-mermaid-source") || selectedText || target.textContent || "",
          tag: target.tagName.toLowerCase(),
          elementText: elementText.replace(/\s+/g, " ").trim().slice(0, 240),
          selectedText: selectedText.trim().slice(0, 1000),
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
