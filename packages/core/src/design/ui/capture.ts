/** Serialized into the sandbox. The host asks for the current viewport, never a rebuilt revision. */
export function capture(
  rasterize:
    | ((
        element: HTMLElement,
        options: {
          width: number
          height: number
          scale: number
          copyDefaultStyles: boolean
          preserveScroll: boolean
          filter: (node: Node) => boolean
          filterStyles: (element: Element, name: string) => boolean
          adjustClonedNode: (original: Node, clone: Node, after: boolean) => void
          onclone: (element: HTMLElement) => void
        },
      ) => Promise<HTMLCanvasElement>)
    | undefined,
  revision: string,
) {
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.type !== "design:capture" || typeof event.data.request !== "string")
      return
    const request = event.data.request
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
    if (!rasterize) return fail("The capture runtime did not load in this preview")
    // A root without a box of its own (display: contents, a shell of fixed children) is still the one on screen.
    const shown = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement)
        if (getComputedStyle(node).display === "none") return false
      return getComputedStyle(element).visibility !== "hidden"
    }
    const variant = [...document.querySelectorAll<HTMLElement>("[data-design-variant]")].find(shown)
    const screen = [...(variant ?? document).querySelectorAll<HTMLElement>("[data-design-screen]")].find(shown)
    const view = {
      revision,
      variant: variant?.dataset.designVariant ?? "",
      screen: screen?.dataset.designScreen ?? "",
      width: innerWidth,
      height: innerHeight,
      scrollX,
      scrollY,
    }
    // The page's stylesheets cannot reach a shadow tree, so an element built there reports what the browser alone
    // gives it. That is what the clone computes for a property nobody writes on it: the picture has no stylesheet.
    const host = document.createElement("div")
    for (const [name, value] of [
      ["all", "initial"],
      ["position", "fixed"],
      ["left", "-99999px"],
      ["top", "0"],
    ])
      host.style.setProperty(name, value, "important")
    const sandbox = host.attachShadow({ mode: "open" })
    document.documentElement.append(host)
    // Browser rules that resolve against these give another result per element, so the model element takes them
    // from the real one and the clone always carries them.
    const mirrored = ["font-size", "color", "direction", "writing-mode"]
    // These decide the box itself and are always written out too.
    const anchors = new Set([
      ...mirrored,
      "display",
      "position",
      "float",
      "box-sizing",
      "width",
      "height",
      "visibility",
    ])
    // An element a model must not be built for: creating it would run code, load a document or act on the page.
    const unmodelled = /^(iframe|frame|object|embed|script|style|link|meta|base|title|head|template|slot)$/
    // Attributes that cannot change what the browser's own rules give an element, or that would load or start something.
    const inert =
      /^(id|class|style|title|alt|name|value|placeholder|for|role|tabindex|src|srcset|sizes|poster|data|action|formaction|autofocus|autoplay|slot|part|is|on.*|data-.*|aria-.*)$/
    const signatures = new WeakMap<Element, string | undefined>()
    // Browser defaults depend on the ancestors and on attributes (a cell in a bordered table, a link with an href, a
    // disabled button), so the model repeats the chain of tags with the attributes that can matter.
    const signature = (element: Element): string | undefined => {
      if (signatures.has(element)) return signatures.get(element)
      const above = element.parentElement ? signature(element.parentElement) : ""
      const own =
        above === undefined ||
        !(element instanceof HTMLElement) ||
        element.hasAttribute("is") ||
        !/^[a-z][a-z0-9]*$/.test(element.localName) ||
        unmodelled.test(element.localName)
          ? undefined
          : `${above}>${element.localName}${[...element.attributes]
              .filter((attribute) => !inert.test(attribute.name))
              .map(
                (attribute) => `[${attribute.name}=${attribute.name === "href" ? "" : attribute.value.slice(0, 32)}]`,
              )
              .join("")}`
      signatures.set(element, own)
      return own
    }
    const baselines = new Map<string, Map<string, string>>()
    const baseline = (element: Element, own: CSSStyleDeclaration) => {
      const chain = signature(element)
      if (chain === undefined) return undefined
      const key = `${chain}|${mirrored.map((name) => own.getPropertyValue(name)).join("|")}`
      const known = baselines.get(key)
      if (known) return known
      const path: Element[] = []
      for (let node: Element | null = element; node; node = node.parentElement) path.unshift(node)
      const models = path.map((node) => {
        const model = document.createElement(node.localName)
        for (const attribute of node.attributes)
          if (!inert.test(attribute.name))
            model.setAttribute(attribute.name, attribute.name === "href" ? "#" : attribute.value)
        return model
      })
      const leaf = models.reduce((parent, child) => parent.appendChild(child))
      for (const name of mirrored) leaf.style.setProperty(name, own.getPropertyValue(name))
      sandbox.append(models[0])
      const style = getComputedStyle(leaf)
      const values = new Map([...style].map((name) => [name, style.getPropertyValue(name)]))
      models[0].remove()
      baselines.set(key, values)
      return values
    }
    const copied = {
      element: undefined as Element | undefined,
      own: undefined as CSSStyleDeclaration | undefined,
      above: undefined as CSSStyleDeclaration | undefined,
      defaults: undefined as Map<string, string> | undefined,
    }
    // A symbol drawn through `use` keeps its styling only when its own tree is cloned, hidden or not.
    const symbols = [...document.querySelectorAll("use")].flatMap((use) => {
      const reference = use.getAttribute("href") ?? use.getAttribute("xlink:href")
      const target = reference?.startsWith("#") ? document.getElementById(reference.slice(1)) : null
      return target ? [target] : []
    })
    const fixed: { clone: HTMLElement; x: number; y: number }[] = []
    void Promise.resolve()
      .then(() =>
        rasterize(document.documentElement, {
          width: view.width,
          height: view.height,
          scale: Math.min(1, 1600 / Math.max(view.width, view.height)),
          // A default-style helper iframe cannot share the opaque sandbox origin; filterStyles does that job instead.
          copyDefaultStyles: false,
          preserveScroll: true,
          // Hidden screens and variants stay in the document; cloning them made real prototypes miss the deadline.
          // Only HTML is skipped: a hidden SVG sprite, a picture's sources and a referenced symbol still take part.
          filter: (node) =>
            node !== host &&
            (!(node instanceof HTMLElement) ||
              /^(source|track|param)$/.test(node.localName) ||
              getComputedStyle(node).display !== "none" ||
              symbols.some((symbol) => node.contains(symbol))),
          // Writing every computed property on every element is what costs the time. A property is written only when
          // the clone would not arrive at it by itself: it differs from what the browser gives the element, or from
          // what the element would inherit.
          filterStyles: (element, name) => {
            // A still picture has no use for motion, and a copied animation would restart in the clone.
            if (name.startsWith("animation") || name.startsWith("transition")) return false
            if (name.startsWith("--") || anchors.has(name)) return true
            if (copied.element !== element) {
              copied.element = element
              copied.own = getComputedStyle(element)
              copied.above = element.parentElement ? getComputedStyle(element.parentElement) : undefined
              copied.defaults = baseline(element, copied.own)
            }
            // Nothing to model or nothing to inherit from (the root, the top of a shadow tree): write everything.
            if (!copied.defaults || !copied.own || !copied.above) return true
            const value = copied.own.getPropertyValue(name)
            return value !== copied.defaults.get(name) || value !== copied.above.getPropertyValue(name)
          },
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
            // Suppress password, payment input and file field values in the detached clone.
            for (const field of element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
              "input[type=password],input[type=file],[autocomplete*='cc-']",
            )) {
              field.value = ""
              field.removeAttribute("value")
              if (field instanceof HTMLTextAreaElement) field.textContent = ""
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
      .finally(() => host.remove())
  })
}
