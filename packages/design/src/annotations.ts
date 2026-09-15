/** Untrusted frame sends descriptive data only. It never receives host credentials. */
export function annotations() {
  const state = {
    enabled: false,
    variant: "",
    manifest: "",
    scroll: undefined as ReturnType<typeof setTimeout> | undefined,
    selected: undefined as Element | undefined,
    reveal: undefined as ReturnType<typeof setTimeout> | undefined,
    /** Variants the host has removed provisionally while the agent publishes the real change. */
    hidden: new Set<string>(),
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
  const visible = () => variants().filter((node) => !state.hidden.has(node.dataset.designVariant!))
  /** Hides every variant but the selected one, and always the ones the host removed. */
  const paint = () => {
    style.textContent = variants()
      .filter((node) => {
        const id = node.dataset.designVariant!
        return state.hidden.has(id) || (!!state.variant && id !== state.variant)
      })
      .map((node) => `[data-design-variant="${node.dataset.designVariant}"]{display:none!important}`)
      .join("\n")
  }
  const selectVariant = (id: string) => {
    if (!visible().some((node) => node.dataset.designVariant === id)) return
    state.variant = id
    paint()
  }
  const announce = () => {
    const items = visible().map((node) => ({
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
  // Element references. A note names its element three ways: a selector verified to resolve to exactly
  // that element within the variant root it lives in (else the document), an absolute XPath, and a label
  // with the containers around it, so the agent can find it in the prototype source.
  const flat = (value: string | null | undefined, limit: number) => {
    const text = (value ?? "").replace(/\s+/g, " ").trim()
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
  }
  const textOf = (target: Element) => (target instanceof HTMLElement ? target.innerText : target.textContent) ?? ""
  const elementText = (target: Element) => {
    if (target instanceof HTMLInputElement) {
      if (target.type === "password" || target.type === "hidden") return ""
      if (target.type === "checkbox" || target.type === "radio") return target.checked ? "checked" : "unchecked"
      return flat(target.value, 240)
    }
    if (target instanceof HTMLSelectElement)
      return flat([...target.selectedOptions].map((option) => option.text).join(", "), 240)
    if (target instanceof HTMLTextAreaElement) return flat(target.value, 240)
    return flat(textOf(target), 240)
  }
  const attribute = (name: string, value: string) =>
    `[${name}="${value.replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ")}"]`
  /** The selected variant root holding the element; other elements are addressed in the whole document. */
  const scopeOf = (target: Element): ParentNode => {
    if (!state.variant) return document
    return (
      variants().find(
        (node) => node.dataset.designVariant === state.variant && node !== target && node.contains(target),
      ) ?? document
    )
  }
  const resolves = (query: string, scope: ParentNode, target: Element) => {
    try {
      const found = scope.querySelectorAll(query)
      return found.length === 1 && found[0] === target
    } catch {
      return false
    }
  }
  /** Selectors built from the element's own stable attributes, most specific first. */
  const own = (target: Element) => {
    const tag = CSS.escape(target.localName)
    const found: string[] = []
    if (target.id) found.push(`#${CSS.escape(target.id)}`)
    const design = target.getAttribute("data-design-id")
    if (design) found.push(attribute("data-design-id", design))
    for (const name of [
      "data-testid",
      "name",
      "aria-label",
      "placeholder",
      "for",
      "title",
      "alt",
      "href",
      "role",
      "type",
    ]) {
      const value = target.getAttribute(name)
      if (value && value.length <= 80) found.push(`${tag}${attribute(name, value)}`)
    }
    const type = target.getAttribute("type")
    const name = target.getAttribute("name")
    if (type && name) found.push(`${tag}${attribute("type", type)}${attribute("name", name)}`)
    found.push(tag)
    return found
  }
  const fullPath = (target: Element) => {
    if (!document.body.contains(target)) return target.localName
    const steps: string[] = []
    for (let node = target; node !== document.body && node.parentElement; node = node.parentElement)
      steps.unshift(`${CSS.escape(node.localName)}:nth-child(${[...node.parentElement.children].indexOf(node) + 1})`)
    return ["body", ...steps].join(" > ")
  }
  const selector = (target: Element) => {
    const scope = scopeOf(target)
    const direct = own(target).find((query) => resolves(query, scope, target))
    if (direct) return direct
    // The nearest ancestor that is unique on its own anchors a short path down to the element.
    const steps: string[] = []
    for (let node = target; node.parentElement; node = node.parentElement) {
      const parent: Element = node.parentElement
      const tag = node.localName
      const index = [...parent.children].filter((child) => child.localName === tag).indexOf(node) + 1
      steps.unshift(`${CSS.escape(tag)}:nth-of-type(${index})`)
      if (parent === scope || parent === document.body || parent === document.documentElement) break
      const anchor = own(parent)
        .filter((query) => query !== CSS.escape(parent.localName))
        .find((query) => resolves(query, scope, parent))
      if (!anchor) continue
      const candidate = [...own(target).map((query) => `${anchor} ${query}`), `${anchor} > ${steps.join(" > ")}`].find(
        (query) => resolves(query, scope, target),
      )
      if (candidate) return candidate
    }
    const relative = steps.join(" > ")
    if (scope !== document && relative && resolves(relative, scope, target)) return relative
    return fullPath(target)
  }
  const xpath = (target: Element) => {
    const steps: string[] = []
    for (let node: Element | null = target; node; node = node.parentElement) {
      const current: Element = node
      const name =
        current.namespaceURI === "http://www.w3.org/1999/xhtml"
          ? current.localName
          : `*[local-name()="${current.localName}"]`
      const same = current.parentElement
        ? [...current.parentElement.children].filter((child) => child.localName === current.localName)
        : [current]
      steps.unshift(same.length > 1 ? `${name}[${same.indexOf(current) + 1}]` : name)
    }
    return `/${steps.join("/")}`
  }
  const referenced = (target: Element) =>
    (target.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => (id ? document.getElementById(id) : null))
      .flatMap((node) => (node ? [textOf(node)] : []))
      .join(" ")
  /** The accessible name a reader would use for the element. */
  const nameOf = (target: Element) => {
    const control = target.matches("input, select, textarea")
    const type = (target.getAttribute("type") ?? "").toLowerCase()
    const labels =
      control && "labels" in target && target.labels
        ? [...(target.labels as NodeListOf<HTMLLabelElement>)]
            .map((node) => {
              const copy = node.cloneNode(true) as Element
              copy.querySelectorAll("input, select, textarea").forEach((child) => child.remove())
              return copy.textContent ?? ""
            })
            .join(" ")
        : ""
    const candidates = [
      referenced(target),
      target.getAttribute("aria-label"),
      labels,
      control ? target.getAttribute("placeholder") : "",
      target.matches("img, area, input[type=image]") ? target.getAttribute("alt") : "",
      target instanceof HTMLInputElement && /^(button|submit|reset)$/.test(type) ? target.value : "",
      control ? "" : textOf(target),
      target.getAttribute("title"),
    ]
    return flat(
      candidates.find((value) => value?.trim()),
      40,
    )
  }
  const kindOf = (target: Element, named: boolean) => {
    const tag = target.localName
    const type = tag === "input" ? (target.getAttribute("type") || "text").toLowerCase() : ""
    const role = target.getAttribute("role")
    const name = target.getAttribute("name")
    return `${tag}${type ? `[type=${flat(type, 20)}]` : ""}${role ? `[role=${flat(role, 20)}]` : ""}${!named && name ? `[name=${flat(name, 30)}]` : ""}`
  }
  const baseLabel = (target: Element) => {
    const name = nameOf(target)
    return name ? `${kindOf(target, true)} "${name}"` : kindOf(target, false)
  }
  const CONTAINERS =
    "form, fieldset, dialog, [role=dialog], table, section, article, nav, aside, header, footer, main, [data-design-id], [data-design-variant]"
  const describe = (container: Element) => {
    // Only the container's own caption or heading names it, never one from a nested section.
    const heading = container.querySelector(
      ":scope > :is(legend, caption, h1, h2, h3, h4, h5, h6), :scope > header > :is(h1, h2, h3, h4, h5, h6)",
    )
    const name = flat(
      referenced(container) ||
        container.getAttribute("aria-label") ||
        (heading ? textOf(heading) : "") ||
        container.getAttribute("title"),
      30,
    )
    const design = container.getAttribute("data-design-id")
    const key = design ? `[data-design-id=${flat(design, 40)}]` : container.id ? `#${flat(container.id, 40)}` : ""
    return `${container.localName}${key}${name ? ` "${name}"` : ""}`
  }
  /** Containers around the element, nearest first; a variant root is named by the target prefix instead. */
  const containers = (target: Element) => {
    const found: Element[] = []
    for (let node = target.parentElement?.closest(CONTAINERS); node; node = node.parentElement?.closest(CONTAINERS))
      if (!node.hasAttribute("data-design-variant")) found.push(node)
    return found
  }
  const context = (target: Element) => {
    const parts = containers(target).slice(0, 3).reverse().map(describe)
    const cell = target.closest("td, th")
    if (cell instanceof HTMLTableCellElement && cell.parentElement instanceof HTMLTableRowElement) {
      const row = cell.parentElement
      const table = cell.closest("table")
      const head = table?.tHead?.rows[0] ?? (table?.rows[0] !== row ? table?.rows[0] : undefined)
      const column = head?.cells[cell.cellIndex]
      const header = row.querySelector("th") ?? row.cells[0]
      if (header && header !== cell) parts.push(`row "${flat(textOf(header), 30)}"`)
      if (column && column !== cell) parts.push(`column "${flat(textOf(column), 30)}"`)
    }
    return flat(parts.join(" > "), 240)
  }
  const label = (target: Element) => {
    const base = baseLabel(target)
    const container = target.parentElement?.closest(CONTAINERS)
    const group = container ?? document.body
    // Other variants are hidden, so only rendered elements compete for the same label.
    const peers = [...group.getElementsByTagName(target.localName)].filter(
      (node) => node === target || node.getClientRects().length > 0,
    )
    if (peers.length < 2 || !peers.some((node) => node !== target && baseLabel(node) === base)) return flat(base, 120)
    const noun = target.localName === "a" ? "links" : `${target.localName}${/s$/.test(target.localName) ? "es" : "s"}`
    const where = container && !container.hasAttribute("data-design-variant") ? ` in ${describe(container)}` : ""
    return flat(`${base} (${peers.indexOf(target) + 1} of ${peers.length} ${noun}${where})`, 120)
  }
  const reference = (target: Element) => ({
    target: state.variant ? `variant:${state.variant} ${selector(target)}` : selector(target),
    xpath: xpath(target),
    context: context(target),
    label: label(target),
  })
  const rect = (target: Element) => {
    const box = target.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }
  // The host addresses elements by the selector this frame reported, prefixed with the variant
  // the element lives in; the host switches variants itself before asking for one.
  const locate = (target: unknown) => {
    if (typeof target !== "string") return undefined
    const prefix = /^variant:([a-zA-Z0-9_-]{1,64}) /.exec(target)
    const query = target.slice(prefix?.[0].length ?? 0)
    if (!query || query === "page" || query === "diagram") return undefined
    try {
      // A selector is unique within the variant root it was captured in; older targets were document-wide.
      const root = prefix ? variants().find((node) => node.dataset.designVariant === prefix[1]) : undefined
      return root?.querySelector(query) ?? document.querySelector(query) ?? undefined
    } catch {
      return undefined
    }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return
    if (event.data?.type === "design:annotate") state.enabled = event.data.enabled === true
    if (event.data?.type === "design:variant" && typeof event.data.id === "string") {
      selectVariant(event.data.id)
      requestAnimationFrame(audit)
    }
    // Provisional variant operations: the host shows the requested change at once and reloads the
    // frame when the agent's revision arrives or the request fails.
    if (event.data?.type === "design:variant-hide" && typeof event.data.id === "string") {
      // Repeats are ignored so the host can resend the change whenever the frame announces.
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(event.data.id) || state.hidden.has(event.data.id)) return
      state.hidden.add(event.data.id)
      announce()
      // The removed root stays hidden whether or not a variant is selected.
      paint()
    }
    if (
      event.data?.type === "design:variant-label" &&
      typeof event.data.id === "string" &&
      typeof event.data.name === "string" &&
      event.data.name.trim()
    ) {
      const node = variants().find((item) => item.dataset.designVariant === event.data.id)
      const name = event.data.name.trim().slice(0, 100)
      if (node && node.dataset.designLabel !== name) node.dataset.designLabel = name
    }
    if (event.data?.type === "design:variant-order" && Array.isArray(event.data.order)) {
      const roots = variants()
      const wanted = event.data.order.flatMap((id: unknown) =>
        roots.filter((node) => typeof id === "string" && node.dataset.designVariant === id),
      ) as HTMLElement[]
      const sorted = [...new Set([...wanted, ...roots])]
      // Only siblings are rearranged: moving roots between parents would break a framework's own tree.
      // Roots that are not siblings keep their place; the host still shows the order in its tabs.
      const container = roots[0]?.parentElement
      if (!container || roots.some((node) => node.parentElement !== container)) return
      // A flex or grid container whose children are all variant roots reorders visually without touching
      // the DOM a framework re-renders. Any other child keeps order 0, so roots would jump past it.
      if (
        /flex|grid/.test(getComputedStyle(container).display) &&
        [...container.children].every((node) => roots.includes(node as HTMLElement))
      ) {
        sorted.forEach((node, index) => node.style.setProperty("order", String(index)))
        return
      }
      // A component entry owns the children of its mount point; moving them could break its next render.
      if (container.closest("#root")) return
      if (sorted.every((node, index) => node === roots[index])) return
      // A marker holds each root's slot among its siblings while the roots trade places.
      const slots = roots.map((node) => {
        const slot = document.createComment("")
        node.before(slot)
        return slot
      })
      sorted.forEach((node, index) => slots[index].replaceWith(node))
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
      // A missing element is reported so the host can drop a card that was anchored to it.
      if (!target) {
        parent.postMessage({ type: "design:rect", target: event.data.target, rect: null }, "*")
        return
      }
      document.querySelectorAll("[data-design-reveal]").forEach((node) => node.removeAttribute("data-design-reveal"))
      clearTimeout(state.reveal)
      if (event.data.pulse !== false) {
        target.setAttribute("data-design-reveal", "")
        state.reveal = setTimeout(() => target.removeAttribute("data-design-reveal"), 2400)
      }
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
  // Keys pressed inside the sandbox never reach the host document; Escape and the A annotation
  // shortcut are the ones it acts on, and neither while the prototype is taking typed text (also
  // inside a web component, hence the composed path).
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing || event.defaultPrevented)
      return
    const target = event.composedPath()[0]
    if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return
    if (event.key === "Escape" && state.enabled) parent.postMessage({ type: "design:key", key: "Escape" }, "*")
    if (event.key.toLowerCase() === "a") parent.postMessage({ type: "design:key", key: "a" }, "*")
  })
  document.addEventListener(
    "click",
    (event) => {
      if (!state.enabled || !(event.target instanceof Element)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const target =
        event.target.closest("[data-mermaid-source], [data-mermaid], .mermaid") ??
        event.target.closest("[data-design-id], [id], button, a, input, select, textarea, td, th, table, svg") ??
        event.target
      // A diagram's source is what the note is about; a text selection is next in line.
      const selectedText = target.getAttribute("data-mermaid-source") || (window.getSelection()?.toString() ?? "")
      state.selected = target
      parent.postMessage(
        {
          type: "design:selection",
          ...reference(target),
          text: target.getAttribute("data-mermaid-source") || selectedText || target.textContent || "",
          tag: target.tagName.toLowerCase(),
          elementText: elementText(target),
          selectedText: selectedText.trim().slice(0, 12000),
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
            ...reference(element),
            tag: element.tagName.toLowerCase(),
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
