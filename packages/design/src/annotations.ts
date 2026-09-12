/** Untrusted frame sends descriptive data only. It never receives host credentials. */
export function annotations() {
  const state = {
    enabled: false,
    variant: "",
    manifest: "",
    scroll: undefined as ReturnType<typeof setTimeout> | undefined,
    selected: undefined as Element | undefined,
    reveal: undefined as ReturnType<typeof setTimeout> | undefined,
  }
  const style = document.createElement("style")
  const marks = document.createElement("style")
  marks.textContent =
    "[data-design-highlight]{outline:2px dashed #ff2056!important;outline-offset:2px!important}[data-design-reveal]{outline:3px solid #ff2056!important;outline-offset:3px!important;animation:design-reveal 1.2s ease-in-out 2}@keyframes design-reveal{50%{outline-color:transparent}}"
  document.head.append(style, marks)
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
  const ancestry = (element: Element): string => {
    if (element.id) return `#${CSS.escape(element.id)}`
    if (!element.parentElement || element === document.body) return element.tagName.toLowerCase()
    return `${ancestry(element.parentElement)} > ${element.tagName.toLowerCase()}:nth-child(${Array.from(element.parentElement.children).indexOf(element) + 1})`
  }
  const selector = (target: Element) =>
    target.id
      ? `#${CSS.escape(target.id)}`
      : target.hasAttribute("data-design-id")
        ? `[data-design-id="${CSS.escape(target.getAttribute("data-design-id")!)}"]`
        : ancestry(target)
  const elementText = (target: Element) =>
    ((target instanceof HTMLElement ? target.innerText : target.textContent) ?? "").replace(/\s+/g, " ").trim()
  const label = (target: Element) => {
    const tag = target.tagName.toLowerCase()
    const text = elementText(target).slice(0, 40)
    return text ? `${tag} "${text}"` : tag
  }
  const rect = (target: Element) => {
    const box = target.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }
  // The host addresses elements by the selector this frame reported, prefixed with the variant
  // the element lives in; the host switches variants itself before asking for one.
  const locate = (target: unknown) => {
    if (typeof target !== "string") return undefined
    const query = target.replace(/^variant:[a-zA-Z0-9_-]{1,64} /, "")
    if (!query || query === "page" || query === "diagram") return undefined
    return document.querySelector(query) ?? undefined
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return
    if (event.data?.type === "design:annotate") state.enabled = event.data.enabled === true
    if (event.data?.type === "design:variant" && typeof event.data.id === "string") {
      selectVariant(event.data.id)
      requestAnimationFrame(audit)
    }
    if (
      event.data?.type === "design:scroll-set" &&
      typeof event.data.x === "number" &&
      typeof event.data.y === "number"
    ) {
      // A reloaded revision restores the reader's place once its layout has settled.
      scrollTo(event.data.x, event.data.y)
      requestAnimationFrame(() => scrollTo(event.data.x, event.data.y))
    }
    if (event.data?.type === "design:highlight") {
      document
        .querySelectorAll("[data-design-highlight]")
        .forEach((node) => node.removeAttribute("data-design-highlight"))
      locate(event.data.target)?.setAttribute("data-design-highlight", "")
    }
    if (event.data?.type === "design:reveal") {
      const target = locate(event.data.target)
      if (!target) return
      document.querySelectorAll("[data-design-reveal]").forEach((node) => node.removeAttribute("data-design-reveal"))
      target.setAttribute("data-design-reveal", "")
      clearTimeout(state.reveal)
      state.reveal = setTimeout(() => target.removeAttribute("data-design-reveal"), 2400)
      state.selected = target
      // Two frames later so the scroll wins over a scroll restore that arrived just before it.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          target.scrollIntoView({ block: "center", inline: "nearest" })
          parent.postMessage({ type: "design:rect", target: event.data.target, rect: rect(target) }, "*")
        }),
      )
    }
    if (
      event.data?.type === "design:tweak" &&
      /^--[a-zA-Z][a-zA-Z0-9-]*$/.test(event.data.key) &&
      typeof event.data.value === "string" &&
      /^[^;{}<>]*$/.test(event.data.value)
    )
      document.documentElement.style.setProperty(event.data.key, event.data.value)
  })
  window.addEventListener(
    "scroll",
    () => {
      if (state.scroll) return
      state.scroll = setTimeout(() => {
        state.scroll = undefined
        parent.postMessage(
          {
            type: "design:scroll",
            x: scrollX,
            y: scrollY,
            ...(state.selected?.isConnected ? { rect: rect(state.selected) } : {}),
          },
          "*",
        )
      }, 100)
    },
    { passive: true },
  )
  // Keys pressed inside the sandbox never reach the host document; Escape is the one it acts on.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.enabled) parent.postMessage({ type: "design:key", key: "Escape" }, "*")
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
      // A diagram's source is what the note is about; a text selection is next in line.
      const selectedText = target.getAttribute("data-mermaid-source") || (window.getSelection()?.toString() ?? "")
      state.selected = target
      parent.postMessage(
        {
          type: "design:selection",
          target: state.variant ? `variant:${state.variant} ${selector(target)}` : selector(target),
          text: target.getAttribute("data-mermaid-source") || selectedText || target.textContent || "",
          tag: target.tagName.toLowerCase(),
          elementText: elementText(target).slice(0, 240),
          selectedText: selectedText.trim().slice(0, 12000),
          label: label(target),
          rect: rect(target),
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
            target: state.variant ? `variant:${state.variant} ${selector(element)}` : selector(element),
            tag: element.tagName.toLowerCase(),
            label: label(element),
            severity: "warn",
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
