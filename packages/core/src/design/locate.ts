export * as DesignLocate from "./locate.js"

/**
 * Resolves a review note's element in a rendered document: by the full selector the review frame
 * recorded (within its variant root, else outside every variant), then by the element's own
 * data-design-id when the selector ends in it, then by XPath. The full selector leads because an
 * anchored selector names an ancestor's id (an icon inside a keyed button) and a repeated id is told
 * apart by its row's position; either id alone would resolve the container or the first row.
 *
 * Runs inside the page, serialized on its own: self-contained, no imports or outer references.
 */
export function resolve(
  document: Document,
  input: { target: string; xpath: string; variant: string },
): { found: false; how: string } | { found: true; how: string; node: Element } {
  const root = input.variant ? document.querySelector(`[data-design-variant="${input.variant}"]`) : null
  if (input.variant && !root) return { found: false, how: "variant missing" }
  const scope: ParentNode = root ?? document
  const query = input.target.replace(/^variant:[a-zA-Z0-9_-]{1,64} /, "").trim()
  const select = (selector: string) => {
    try {
      return (
        scope.querySelector(selector) ??
        (root
          ? [...document.querySelectorAll(selector)].find((node) => !node.closest("[data-design-variant]"))
          : undefined)
      )
    } catch {
      return undefined
    }
  }
  // A page-level note names no element: it is judged against the whole variant, or the document body.
  if (query === "page") {
    const whole = root ?? document.body
    return whole ? { found: true, how: "page", node: whole } : { found: false, how: "not found" }
  }
  const located = query && query !== "diagram" ? select(query) : undefined
  // The selector's last compound is the element's own id, as in tr[data-design-id="row"] [data-design-id="save"];
  // a positional compound (:nth-of-type) marks a repeated id, which alone would resolve the first one.
  const own = /(?:^|[\s>+~])[^\s>+~[\]:]*(\[data-design-id="(?:[^"\\]|\\.)*"\])$/.exec(query)?.[1]
  if (located) return { found: true, how: own ? "data-design-id" : "selector", node: located }
  const keyed = own ? select(own) : undefined
  if (keyed) return { found: true, how: "data-design-id", node: keyed }
  const traced = input.xpath ? trace(document, input.xpath) : null
  if (!traced) return { found: false, how: "not found" }
  return traced instanceof Element && (!root || root.contains(traced))
    ? { found: true, how: "xpath", node: traced }
    : { found: false, how: "not found" }

  function trace(document: Document, xpath: string) {
    try {
      return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    } catch {
      return null
    }
  }
}

/**
 * What a verify compares of a located element across two revisions: its text with whitespace
 * collapsed, and an FNV-1a fingerprint of its markup plus `style`, the computed style the page read
 * for it. The verify's own marker attribute is left out, so marking the element never counts as a
 * change. Runs inside the page like `resolve`: self-contained.
 */
export function facts(element: Element, style: string) {
  const markup = `${element.outerHTML.replace(/ data-redcode-verify="[^"]*"/g, "")}\n${style}`
  // A loop, not an array of code units: an element's markup can be large.
  let hash = 0x811c9dc5
  for (let index = 0; index < markup.length; index++) hash = Math.imul(hash ^ markup.charCodeAt(index), 16777619)
  return { text: (element.textContent ?? "").replace(/\s+/g, " ").trim(), markup: (hash >>> 0).toString(16) }
}
