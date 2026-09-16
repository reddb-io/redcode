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
  // Element references. A note names its element four ways: a selector verified to resolve to exactly
  // that element within the variant root it lives in (else the document), an absolute XPath, its parent
  // and grandparent with their XPaths, and a label that reads as a breadcrumb through the named
  // ancestors around it, so the agent can find it in the prototype source. A click inside a shadow root
  // arrives retargeted to its host, and a nested iframe is another document this script does not run
  // in, so both are addressed by their host element.
  const LIMITS = { target: 1000, xpath: 2000, label: 240, parent: 1200, context: 240, peers: 50, findings: 30 }
  /** Collapses whitespace and cuts by code point, so a surrogate pair is never split. */
  const flat = (value: string | null | undefined, limit: number) => {
    const text = (value ?? "").replace(/\s+/g, " ").trim()
    const chars = [...text]
    return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : text
  }
  const textOf = (target: Element) => (target instanceof HTMLElement ? target.innerText : target.textContent) ?? ""
  const elementText = (target: Element) => {
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    ) {
      // Payment fields, secrets and local file paths never leave the frame.
      const autocomplete = (target.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/)
      if (autocomplete.some((token) => token.startsWith("cc-"))) return ""
    }
    if (target instanceof HTMLInputElement) {
      if (target.type === "password" || target.type === "hidden" || target.type === "file") return ""
      if (target.type === "checkbox" || target.type === "radio") return target.checked ? "checked" : "unchecked"
      return flat(target.value, 240)
    }
    if (target instanceof HTMLSelectElement)
      return flat([...target.selectedOptions].map((option) => option.text).join(", "), 240)
    if (target instanceof HTMLTextAreaElement) return flat(target.value, 240)
    return flat(textOf(target), 240)
  }
  const attribute = (name: string, value: string) => `[${name}="${CSS.escape(value)}"]`
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
  const typeIndex = (node: Element) =>
    node.parentElement
      ? [...node.parentElement.children].filter((child) => child.localName === node.localName).indexOf(node) + 1
      : 1
  /** One path step; a repeated data-design-id (list rows) keeps its key and adds the position. */
  const step = (node: Element) => {
    const design = node.getAttribute("data-design-id")
    return `${CSS.escape(node.localName)}${design ? attribute("data-design-id", design) : ""}:nth-of-type(${typeIndex(node)})`
  }
  /**
   * Keys that survive a revision, most stable first. A data-design-id leads because framework ids
   * (React useId, Radix, Headless UI) are unique on one render but change on the next.
   */
  const keys = (target: Element) => {
    const tag = CSS.escape(target.localName)
    const found: string[] = []
    const design = target.getAttribute("data-design-id")
    if (design) found.push(attribute("data-design-id", design))
    if (target.id) found.push(`#${CSS.escape(target.id)}`)
    for (const name of ["data-testid", "name", "aria-label", "for", "role", "type"]) {
      const value = target.getAttribute(name)
      if (value && value.length <= 80) found.push(`${tag}${attribute(name, value)}`)
    }
    const type = target.getAttribute("type")
    const name = target.getAttribute("name")
    if (type && name) found.push(`${tag}${attribute("type", type)}${attribute("name", name)}`)
    if (design) found.push(step(target))
    return found
  }
  /** Visible copy a note often asks to change, so it ranks after structural paths. */
  const copy = (target: Element) => {
    const tag = CSS.escape(target.localName)
    return ["placeholder", "title", "alt", "href"].flatMap((name) => {
      const value = target.getAttribute(name)
      return value && value.length <= 80 ? [`${tag}${attribute(name, value)}`] : []
    })
  }
  const bodyPath = (target: Element) => {
    if (target === document.body || !document.body.contains(target)) return target.localName
    const steps: string[] = []
    for (let node: Element = target; node !== document.body && node.parentElement; node = node.parentElement)
      steps.unshift(step(node))
    return ["body", ...steps].join(" > ")
  }
  const selector = (target: Element) => {
    const scope = scopeOf(target)
    const budget = LIMITS.target - (state.variant ? `variant:${state.variant} `.length : 0)
    const fits = (query: string) => query.length <= budget && resolves(query, scope, target)
    const own = keys(target)
    const direct = own.find(fits)
    if (direct) return direct
    // The nearest ancestor that is unique on its own anchors a short path down to the element.
    const steps: string[] = []
    for (let node: Element = target; node.parentElement; node = node.parentElement) {
      const parent: Element = node.parentElement
      steps.unshift(step(node))
      if (parent === scope || parent === document.body || parent === document.documentElement) break
      const anchor = keys(parent).find((query) => resolves(query, scope, parent))
      if (!anchor) continue
      const anchored = [...own.map((query) => `${anchor} ${query}`), `${anchor} > ${steps.join(" > ")}`].find(fits)
      if (anchored) return anchored
    }
    const fallback = [...copy(target), CSS.escape(target.localName), bodyPath(target)].find(fits)
    // A locator cut to fit would point elsewhere; an element too deep to address is reported as the page.
    return fallback ?? "page"
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
        ? [...current.parentElement.children].filter((child) => child.localName === current.localName).length
        : 1
      steps.unshift(same > 1 ? `${name}[${typeIndex(current)}]` : name)
    }
    const path = `/${steps.join("/")}`
    return path.length <= LIMITS.xpath ? path : ""
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
              const clone = node.cloneNode(true) as Element
              clone.querySelectorAll("input, select, textarea").forEach((child) => child.remove())
              return clone.textContent ?? ""
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
  const kindOf = (target: Element) => {
    const tag = target.localName
    const type = tag === "input" ? (target.getAttribute("type") || "text").toLowerCase() : ""
    const role = target.getAttribute("role")
    const design = target.getAttribute("data-design-id")
    return `${tag}${type ? `[type=${flat(type, 20)}]` : ""}${role ? `[role=${flat(role, 20)}]` : ""}${design ? `[data-design-id="${flat(design, 40)}"]` : ""}`
  }
  const baseLabel = (target: Element, kind = kindOf(target)) => {
    const name = nameOf(target)
    if (name) return `${kind} "${name}"`
    const field = target.getAttribute("name")
    return field ? `${kind}[name="${flat(field, 30)}"]` : kind
  }
  // An ancestor worth naming in a breadcrumb: it has a stable key, a role, an accessible name, or it
  // is a landmark, a control or a repeated item. Table rows and cells are named by the row and column
  // headers instead. A variant root is named by the target prefix.
  const ANCESTORS =
    "[data-design-id], [id], [role], [aria-label], [aria-labelledby], button, a, label, li, nav, header, footer, aside, main, section, article, dialog, form, fieldset, table, details, summary, h1, h2, h3, h4, h5, h6"
  const LANDMARKS = "nav, header, footer, aside, main, section, article, dialog, form, [role]"
  /** Elements whose own text is their name; a container is named by its caption or heading only. */
  const LEAVES =
    "button, a, label, summary, legend, li, option, h1, h2, h3, h4, h5, h6, [role=button], [role=link], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=listitem], [role=treeitem]"
  const describe = (container: Element) => {
    // Only the container's own caption or heading names it, never one from a nested section.
    const heading = container.matches(LEAVES)
      ? undefined
      : container.querySelector(
          ":scope > :is(legend, caption, h1, h2, h3, h4, h5, h6), :scope > header > :is(h1, h2, h3, h4, h5, h6)",
        )
    const name = flat(
      referenced(container) ||
        container.getAttribute("aria-label") ||
        (container.matches(LEAVES) ? textOf(container) : heading ? textOf(heading) : "") ||
        container.getAttribute("title"),
      30,
    )
    // A data-design-id is already in the kind; a plain id is the next most stable key.
    const key = !container.getAttribute("data-design-id") && container.id ? `[id="${flat(container.id, 40)}"]` : ""
    return `${kindOf(container)}${key}${name ? ` "${name}"` : ""}`
  }
  const named = (node: Element) =>
    node.hasAttribute("data-design-id") || !!referenced(node) || !!node.getAttribute("aria-label")
  /** Named ancestors, nearest first; variant roots and the body are never part of the chain. */
  const ancestors = (target: Element) => {
    const found: Element[] = []
    for (let node = target.parentElement?.closest(ANCESTORS); node; node = node.parentElement?.closest(ANCESTORS))
      if (!node.hasAttribute("data-design-variant") && node !== document.body && node !== document.documentElement)
        found.push(node)
    return found
  }
  /**
   * The ancestors a breadcrumb keeps: the two nearest, and the outermost landmark (else the outermost
   * named one, else the outermost), so a deep element still says which region of the page it is in.
   */
  const chain = (target: Element) => {
    const all = ancestors(target)
    if (all.length <= 3) return all
    const rest = all.slice(2).reverse()
    const outer = rest.find((node) => node.matches(LANDMARKS)) ?? rest.find(named) ?? rest[0]
    return [...all.slice(0, 2), outer]
  }
  /** The column a cell starts in, counting the spans of the cells before it. */
  const columnOf = (cell: HTMLTableCellElement) =>
    [...(cell.parentElement as HTMLTableRowElement).cells]
      .slice(0, cell.cellIndex)
      .reduce((total, item) => total + item.colSpan, 0)
  const cellAt = (row: HTMLTableRowElement, column: number) => {
    let start = 0
    for (const cell of row.cells) {
      if (column < start + cell.colSpan) return cell
      start += cell.colSpan
    }
    return undefined
  }
  /** The row and column headers of the table cell holding the element, when it is in a body row. */
  const cellOf = (target: Element) => {
    const cell = target.closest("td, th")
    if (!(cell instanceof HTMLTableCellElement) || !(cell.parentElement instanceof HTMLTableRowElement)) return {}
    const row = cell.parentElement
    // table.rows and row.cells never include a nested table's rows or cells.
    const table = cell.closest("table")
    const first = table?.rows[0]
    const head =
      table?.tHead?.rows[0] ?? (first && [...first.cells].every((item) => item.localName === "th") ? first : undefined)
    if (row === head) return {}
    const header = [...row.cells].find((item) => item.localName === "th") ?? row.cells[0]
    const column = head ? cellAt(head, columnOf(cell)) : undefined
    return {
      row: header && header !== cell ? `row "${flat(textOf(header), 30)}"` : "",
      column: column ? `column "${flat(textOf(column), 30)}"` : "",
    }
  }
  /** The places around the element, nearest first: its table row, then its named ancestors. */
  const crumbs = (target: Element) => {
    const cell = cellOf(target)
    return [...(cell.row ? [cell.row] : []), ...chain(target).map(describe)]
  }
  const context = (target: Element) => {
    const column = cellOf(target).column
    return flat([...crumbs(target).reverse(), ...(column ? [column] : [])].join(" > "), LIMITS.context)
  }
  /** The breadcrumb without a position: the element, then where it is, innermost first. */
  const breadcrumb = (target: Element, base = baseLabel(target)) => {
    const parts = crumbs(target).slice(0, 3)
    // A bare tag never stands alone: an element outside every named ancestor names its parent.
    const where = parts.length ? parts : [describe(target.parentElement ?? document.body)]
    return `${base} in ${where.join(" in ")}`
  }
  const label = (target: Element) => {
    const kind = kindOf(target)
    const base = baseLabel(target, kind)
    const full = breadcrumb(target, base)
    const scope = scopeOf(target)
    const root = scope instanceof Element ? scope : document.body
    // Other variants are hidden, so only rendered elements compete for the same breadcrumb. It is
    // only computed for peers of the same kind and name, and the scan stops after enough of them.
    let total = 0
    let index = 0
    let compared = 0
    let more = false
    for (const node of root.getElementsByTagName(target.localName)) {
      if (node === target) {
        total++
        index = total
        continue
      }
      if (compared >= LIMITS.peers) {
        more = true
        break
      }
      if (kindOf(node) !== kind || node.getClientRects().length === 0 || baseLabel(node, kind) !== base) continue
      compared++
      if (breadcrumb(node, base) === full) total++
    }
    return flat(total > 1 ? `${full} (${index} of ${total}${more ? "+" : ""})` : full, LIMITS.label)
  }
  /** The parent and grandparent with their XPaths, so a note on a bare element still says what holds it. */
  const parentOf = (target: Element) => {
    const parent = target.parentElement
    if (!parent || parent === document.documentElement) return ""
    const one = (node: Element) => {
      const path = xpath(node)
      return `${describe(node)}${path ? ` (${path})` : ""}`
    }
    const grand = parent.parentElement
    const both = grand && grand !== document.documentElement ? `${one(parent)} in ${one(grand)}` : one(parent)
    const value = [both, one(parent)].find((item) => item.length <= LIMITS.parent)
    return value ?? ""
  }
  const reference = (target: Element) => ({
    target: state.variant ? `variant:${state.variant} ${selector(target)}` : selector(target),
    xpath: xpath(target),
    context: context(target),
    label: label(target),
    parent: parentOf(target),
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
      if (!prefix) return document.querySelector(query) ?? undefined
      // A selector is unique within the variant root it was captured in. Older targets were document-wide,
      // so a match outside every variant still counts, but never one inside another variant.
      const root = variants().find((node) => node.dataset.designVariant === prefix[1])
      return (
        root?.querySelector(query) ??
        [...document.querySelectorAll(query)].find((node) => !node.closest("[data-design-variant]")) ??
        undefined
      )
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
    // Overflow is measured first and only the reported elements are described, which is the costly part.
    const findings = [...document.querySelectorAll("button, input, select, textarea, h1, h2, p")]
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return !!box.width && !!box.height && (box.right > innerWidth + 1 || box.left < -1)
      })
      .slice(0, LIMITS.findings)
      .map((element) => ({
        ...reference(element),
        tag: element.tagName.toLowerCase(),
        severity: "warn",
        text: "Element extends beyond the viewport",
      }))
    parent.postMessage({ type: "design:layout", findings }, "*")
  }
  void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(audit)))
  const resize = new ResizeObserver(() => requestAnimationFrame(audit))
  resize.observe(document.documentElement)
}
