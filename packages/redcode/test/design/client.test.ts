import { describe, expect, test } from "bun:test"
import {
  deriveQueueKey,
  elementSelector,
  isMermaidSvg,
  isModeToggleHotkeyEvent,
  isNativeInteractiveControl,
  mermaidNodeElement,
  mermaidNodeFrom,
  readNodeLabel,
  tableCellTarget,
} from "@/design/client/helpers"

// The client is driven here with hand-built nodes that implement only what each helper reads —
// tagName, attributes, parent/children, closest, querySelector — which keeps these tests honest
// about what the helpers depend on, and free of a DOM library. Ported from lavish-axi.

type Fake = {
  tagName: string
  nodeName: string
  nodeType: number
  id: string
  className: string
  name?: string
  type?: string
  value?: string
  rowSpan?: number
  parentElement: Fake | null
  children: Fake[]
  attrs: Record<string, string>
  _text: string
  readonly textContent: string
  getAttribute(name: string): string | null
  closest(selectors: string): Fake | null
  matches(selectors: string): boolean
  querySelector(selectors: string): Fake | null
  querySelectorAll(selectors: string): Fake[]
  cloneNode(deep?: boolean): Fake
  replaceWith(other: Fake): void
}

const classes = (node: Fake) => (node.className || "").split(/\s+/).filter(Boolean)

const matchesOne = (node: Fake, selector: string): boolean => {
  if (selector === "g.nodes > g")
    return node.tagName.toLowerCase() === "g" && !!node.parentElement && classes(node.parentElement).includes("nodes")
  if (selector === "[contenteditable]:not([contenteditable='false'])") {
    const value = node.getAttribute("contenteditable")
    return value !== null && value !== "false"
  }
  const tagClass = /^([a-z]+)\.([a-z0-9_-]+)$/i.exec(selector)
  if (tagClass) return node.tagName.toLowerCase() === tagClass[1]!.toLowerCase() && classes(node).includes(tagClass[2]!)
  if (/^[a-z]+$/i.test(selector)) return node.tagName.toLowerCase() === selector.toLowerCase()
  if (selector.startsWith(".")) return classes(node).includes(selector.slice(1))
  const attr = /^\[([a-z-]+)(?:='([^']*)')?\]$/i.exec(selector)
  if (attr) {
    const value = node.getAttribute(attr[1]!)
    return attr[2] === undefined ? value !== null : value === attr[2]
  }
  return false
}
const matches = (node: Fake, list: string) => list.split(",").some((s) => matchesOne(node, s.trim()))
const descendants = (node: Fake): Fake[] => node.children.flatMap((c) => [c, ...descendants(c)])

function el(
  tag: string,
  opts: { id?: string; className?: string; attrs?: Record<string, string>; text?: string; children?: Fake[] } = {},
): Fake {
  const node: Fake = {
    tagName: tag.toUpperCase(),
    nodeName: tag.toUpperCase(),
    nodeType: 1,
    id: opts.id || opts.attrs?.id || "",
    className: opts.className || "",
    parentElement: null,
    children: [],
    attrs: { ...(opts.attrs || {}) },
    _text: opts.text || "",
    get textContent() {
      if (this.children.length === 0 || this._text) return this._text
      return this.children.map((c) => (c.tagName === "BR" ? "" : c.textContent)).join("")
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? String(this.attrs[name]) : null
    },
    closest(selectors) {
      let current: Fake | null = this
      while (current) {
        if (matches(current, selectors)) return current
        current = current.parentElement
      }
      return null
    },
    matches(selectors) {
      return matches(this, selectors)
    },
    querySelector(selectors) {
      return descendants(this).find((d) => matches(d, selectors)) || null
    },
    querySelectorAll(selectors) {
      return descendants(this).filter((d) => matches(d, selectors))
    },
    cloneNode() {
      const clone = el(tag, { id: this.id, className: this.className, attrs: this.attrs, text: this._text })
      for (const child of this.children) append(clone, child.cloneNode(true))
      return clone
    },
    replaceWith(other) {
      const parent = this.parentElement
      if (!parent) return
      const at = parent.children.indexOf(this)
      if (at >= 0) parent.children.splice(at, 1, other)
      other.parentElement = parent
    },
  }
  if (opts.attrs?.name) node.name = opts.attrs.name
  if (opts.attrs?.type) node.type = opts.attrs.type
  if (opts.attrs?.value) node.value = opts.attrs.value
  for (const child of opts.children || []) append(node, child)
  return node
}
const append = (parent: Fake, child: Fake) => {
  child.parentElement = parent
  parent.children.push(child)
  return child
}
const node = (tag: string, attrs: Record<string, string> = {}, children: Fake[] = []) =>
  el(tag, { attrs, text: attrs.textContent, children })

// readNodeLabel swaps <br> for a text node; give it the one document member it needs.
;(globalThis as { document?: unknown }).document ??= {
  createTextNode: (text: string) => ({
    tagName: "#text",
    nodeType: 3,
    textContent: String(text),
    parentElement: null,
    children: [],
  }),
}

describe("the mode hotkey", () => {
  test("is Cmd/Ctrl+I, case-insensitive, and nothing that could be typing", () => {
    expect(isModeToggleHotkeyEvent({ key: "i", metaKey: true })).toBe(true)
    expect(isModeToggleHotkeyEvent({ key: "I", ctrlKey: true })).toBe(true)
    expect(isModeToggleHotkeyEvent({ key: "i" })).toBe(false)
    expect(isModeToggleHotkeyEvent({ key: "i", metaKey: true, shiftKey: true })).toBe(false)
    expect(isModeToggleHotkeyEvent({ key: "i", ctrlKey: true, altKey: true })).toBe(false)
    expect(isModeToggleHotkeyEvent({ key: "k", metaKey: true })).toBe(false)
  })
})

describe("what counts as a control", () => {
  test("leaves a details body annotatable while its summary is a control", () => {
    const summaryChild = node("span")
    const summary = node("summary", {}, [summaryChild])
    const bodyText = node("span")
    const bodyLink = node("a", { href: "#target" })
    const body = node("div", {}, [bodyText, bodyLink])
    const details = node("details", { open: "" }, [summary, body])
    expect(isNativeInteractiveControl(summaryChild)).toBe(true)
    expect(isNativeInteractiveControl(details)).toBe(false)
    expect(isNativeInteractiveControl(bodyText)).toBe(false)
    expect(isNativeInteractiveControl(bodyLink)).toBe(false)
  })
})

describe("the selector", () => {
  test("stops at an id, counts only same-tag siblings, and goes five deep at most", () => {
    const target = node("p")
    const other = node("span")
    const section = node("section", {}, [other, node("p"), target])
    const main = node("main", { id: "root" }, [section])
    node("body", {}, [main])
    expect(elementSelector(target)).toBe("main#root > section > p:nth-of-type(2)")
    const deep = node("i")
    let wrap: Fake = deep
    for (const tag of ["b", "em", "strong", "small", "span", "div", "section"]) wrap = node(tag, {}, [wrap])
    expect(elementSelector(deep).split(" > ")).toHaveLength(5)
  })
})

describe("the queue key, which lets an unsent answer replace an earlier one", () => {
  test("uses an explicit queueKey first, and an explicit empty one disables it", () => {
    const input = node("input", { type: "radio", name: "plan" })
    expect(deriveQueueKey(input, { queueKey: "deployment-plan" })).toBe("deployment-plan")
    const button = node("button")
    node("section", { "data-redcode-question": "deployment-plan" }, [button])
    expect(deriveQueueKey(button, { queueKey: "" })).toBe("")
  })

  test("groups controls inside a question, under our attribute or lavish's", () => {
    const first = node("button")
    const second = node("button")
    node("section", { "data-redcode-question": "deployment-plan" }, [first, second])
    expect(deriveQueueKey(first)).toBe("question:deployment-plan")
    expect(deriveQueueKey(second)).toBe("question:deployment-plan")
    const alias = node("button")
    node("section", { "data-lavish-question": "legacy" }, [alias])
    expect(deriveQueueKey(alias)).toBe("question:legacy")
  })

  test("groups radios by scoped group name, and keeps the same name apart across scopes", () => {
    const planA = node("input", { id: "plan-a", type: "radio", name: "plan", value: "A" })
    const planB = node("input", { id: "plan-b", type: "radio", name: "plan", value: "B" })
    node("form", { id: "deploy" }, [planA, planB])
    expect(deriveQueueKey(planA)).toBe("radio:form:deploy:plan")
    expect(deriveQueueKey(planB)).toBe("radio:form:deploy:plan")
    const one = node("input", { type: "radio", name: "plan", value: "A" })
    const two = node("input", { type: "radio", name: "plan", value: "B" })
    node("form", { id: "deploy-one" }, [one])
    node("form", { id: "deploy-two" }, [two])
    expect(deriveQueueKey(one)).not.toBe(deriveQueueKey(two))
  })

  test("does not infer grouping for a plain button", () => {
    expect(deriveQueueKey(node("button"))).toBe("")
  })

  test("keys checkboxes each on their own, even with the same name and default value", () => {
    const first = node("input", { type: "checkbox", name: "feature", value: "search" })
    const second = node("input", { type: "checkbox", name: "feature", value: "billing" })
    node("form", { id: "features" }, [first, second])
    expect(deriveQueueKey(first)).not.toBe(deriveQueueKey(second))
    const a = node("input", { id: "search", type: "checkbox", name: "feature" })
    const b = node("input", { id: "billing", type: "checkbox", name: "feature" })
    a.value = "on"
    b.value = "on"
    node("form", { id: "features" }, [a, b])
    expect(deriveQueueKey(a)).not.toBe(deriveQueueKey(b))
  })

  test("keys named selects as fields", () => {
    const select = node("select", { name: "region" })
    node("form", { id: "deploy" }, [select])
    expect(deriveQueueKey(select)).toBe("field:form:deploy:region")
  })
})

describe("naming a table cell", () => {
  const row = (cells: (string | Fake)[], tag = "td") =>
    node(
      "tr",
      {},
      cells.map((cell) => (typeof cell === "string" ? node(tag, { textContent: cell }) : cell)),
    )
  const labels = (element: Fake) => {
    const target = tableCellTarget(element, () => "")
    return { rowLabel: target?.rowLabel, columnLabel: target?.columnLabel }
  }

  test("names a filtered table cell by row and column instead of visible position", () => {
    const target = node("td", { textContent: "Drive, Neovide, Cursor, Alacritty" })
    node("table", {}, [
      node("thead", {}, [row(["Permission / setting", "Visible state", "Database evidence"], "th")]),
      node("tbody", {}, [row(["Contacts", "None", "No grants"]), row(["Media & Apple Music", "4 apps", target])]),
    ])
    expect(tableCellTarget(target, () => "table > tbody > tr:nth-of-type(2) > td:nth-of-type(3)")).toEqual({
      type: "table-cell",
      selector: "table > tbody > tr:nth-of-type(2) > td:nth-of-type(3)",
      rowLabel: "Media & Apple Music",
      columnLabel: "Database evidence",
      text: "Drive, Neovide, Cursor, Alacritty",
    })
  })

  test("reads header cells from the first row when the table has no thead", () => {
    const target = node("td", { textContent: "4 apps" })
    node("table", {}, [
      node("tbody", {}, [row(["Permission", "Visible state"], "th"), row(["Media & Apple Music", target])]),
    ])
    expect(labels(target)).toEqual({ rowLabel: "Media & Apple Music", columnLabel: "Visible state" })
  })

  test("names no row for any all-th header row when the table has no thead", () => {
    const target = node("th", { textContent: "Visible state" })
    node("table", {}, [
      node("tbody", {}, [
        node("tr", {}, [node("th", { textContent: "Permission" }), node("th", { colspan: "2", textContent: "State" })]),
        node("tr", {}, [node("th", { textContent: "Permission" }), target, node("th", { textContent: "Database" })]),
        row(["Media & Apple Music", "4 apps", "Drive"]),
      ]),
    ])
    expect(labels(target)).toEqual({ rowLabel: "", columnLabel: "" })
  })

  test("does not treat a leading data row as column headers", () => {
    const target = node("td", { textContent: "4 apps" })
    node("table", {}, [node("tbody", {}, [row(["Contacts", "None"]), row(["Media & Apple Music", target])])])
    expect(labels(target)).toEqual({ rowLabel: "Media & Apple Music", columnLabel: "" })
  })

  test("stays silent about the column under a grouped header, and names it from the leaf row", () => {
    const grouped = node("td", { textContent: "4 apps" })
    node("table", {}, [
      node("thead", {}, [
        node("tr", {}, [node("th", { textContent: "Permission" }), node("th", { colspan: "2", textContent: "State" })]),
      ]),
      node("tbody", {}, [row(["Media & Apple Music", grouped, node("td", { textContent: "Drive" })])]),
    ])
    expect(labels(grouped)).toEqual({ rowLabel: "Media & Apple Music", columnLabel: "" })
    const leaf = node("td", { textContent: "4 apps" })
    node("table", {}, [
      node("thead", {}, [
        node("tr", {}, [node("th", { textContent: "Permission" }), node("th", { colspan: "2", textContent: "State" })]),
        row(["Permission", "Visible state", "Database evidence"], "th"),
      ]),
      node("tbody", {}, [row(["Media & Apple Music", leaf, node("td", { textContent: "Drive" })])]),
    ])
    expect(labels(leaf)).toEqual({ rowLabel: "Media & Apple Music", columnLabel: "Visible state" })
  })

  const shiftedByRowSpan = (target: Fake, rowspan = "2") => {
    node("table", {}, [
      node("thead", {}, [row(["Permission", "Visible state"], "th")]),
      node("tbody", {}, [
        node("tr", {}, [node("td", { rowspan, textContent: "Media" }), node("td", { textContent: "None" })]),
        node("tr", {}, [target, node("td", { textContent: "extra" })]),
      ]),
    ])
    return target
  }

  test("names neither coordinate when a rowspan above shifts the row: finite, zero, or with trailing junk", () => {
    expect(labels(shiftedByRowSpan(node("td", { textContent: "4 apps" })))).toEqual({ rowLabel: "", columnLabel: "" })
    expect(labels(shiftedByRowSpan(node("td", { textContent: "4 apps" }), "0"))).toEqual({
      rowLabel: "",
      columnLabel: "",
    })
    expect(labels(shiftedByRowSpan(node("td", { textContent: "4 apps" }), "2x"))).toEqual({
      rowLabel: "",
      columnLabel: "",
    })
  })

  test("restores the labels after a finite rowspan ends", () => {
    const target = node("td", { textContent: "4 apps" })
    node("table", {}, [
      node("thead", {}, [row(["Permission", "Visible state"], "th")]),
      node("tbody", {}, [
        node("tr", {}, [node("td", { rowspan: "2", textContent: "Media" }), node("td", { textContent: "None" })]),
        node("tr", {}, [node("td", { textContent: "1 app" })]),
        row(["Media & Apple Music", target]),
      ]),
    ])
    expect(labels(target)).toEqual({ rowLabel: "Media & Apple Music", columnLabel: "Visible state" })
  })

  test("keeps a declared scope=row heading even when a rowspan shifts the grid, and prefers it over the first cell", () => {
    const shifted = node("td", { textContent: "4 apps" })
    node("table", {}, [
      node("thead", {}, [row(["Permission", "Visible state"], "th")]),
      node("tbody", {}, [
        node("tr", {}, [node("td", { rowspan: "2", textContent: "Media" }), node("td", { textContent: "None" })]),
        node("tr", {}, [node("th", { scope: "row", textContent: "Media & Apple Music" }), shifted]),
      ]),
    ])
    expect(labels(shifted)).toEqual({ rowLabel: "Media & Apple Music", columnLabel: "" })
    const declared = node("td", { textContent: "4 apps" })
    node("table", {}, [
      node("thead", {}, [row(["Index", "Permission", "Visible state"], "th")]),
      node("tbody", {}, [
        node("tr", {}, [
          node("td", { textContent: "7" }),
          node("th", { scope: "row", textContent: "Media & Apple Music" }),
          declared,
        ]),
      ]),
    ])
    expect(labels(declared)).toEqual({ rowLabel: "Media & Apple Music", columnLabel: "Visible state" })
  })

  test("stays silent about the column when the row does not span the header width", () => {
    const target = node("td", { textContent: "4 apps" })
    node("table", {}, [
      node("thead", {}, [row(["Permission", "Visible state", "Database evidence"], "th")]),
      node("tbody", {}, [row(["Media & Apple Music", target])]),
    ])
    expect(labels(target)).toEqual({ rowLabel: "Media & Apple Music", columnLabel: "" })
  })

  test("a header click gets its column but no row; an upper grouped header row gets neither", () => {
    const head = node("th", { textContent: "Visible state" })
    node("table", {}, [
      node("thead", {}, [node("tr", {}, [node("th", { textContent: "Permission" }), head])]),
      node("tbody", {}, [row(["Media & Apple Music", "4 apps"])]),
    ])
    expect(labels(head)).toEqual({ rowLabel: "", columnLabel: "Visible state" })
    const upper = node("th", { colspan: "2", textContent: "State" })
    node("table", {}, [
      node("thead", {}, [
        node("tr", {}, [node("th", { textContent: "Permission" }), upper]),
        row(["Permission", "Visible state", "Database evidence"], "th"),
      ]),
      node("tbody", {}, [row(["Media & Apple Music", "4 apps", "Drive"])]),
    ])
    expect(labels(upper)).toEqual({ rowLabel: "", columnLabel: "" })
  })

  test("a rowspan confined to the header, or to another row group, does not shift a body row", () => {
    const target = node("td", { textContent: "ok" })
    node("table", {}, [
      node("thead", {}, [
        node("tr", {}, [
          node("th", { rowspan: "2", textContent: "Feature" }),
          node("th", { textContent: "Result" }),
          node("th", { textContent: "Notes" }),
        ]),
        row(["A", "B", "C"], "th"),
      ]),
      node("tbody", {}, [row([node("td", { textContent: "Login" }), target, node("td", { textContent: "fine" })])]),
    ])
    expect(labels(target)).toEqual({ rowLabel: "Login", columnLabel: "" })
    const other = node("td", { textContent: "4 apps" })
    node("table", {}, [
      node("thead", {}, [row(["Permission", "Visible state"], "th")]),
      node("tbody", {}, [row(["Media & Apple Music", other])]),
      node("tfoot", {}, [
        node("tr", {}, [node("td", { rowspan: "2", textContent: "Total" }), node("td", { textContent: "4" })]),
        node("tr", {}, [node("td", { textContent: "5" })]),
      ]),
    ])
    expect(labels(other)).toEqual({ rowLabel: "Media & Apple Music", columnLabel: "Visible state" })
  })

  test("trusts the span the browser parsed over the attribute, and reads an empty one as 1", () => {
    const target = node("td", { textContent: "4 apps" })
    const spanning = node("td", { rowspan: "junk", textContent: "Media" })
    spanning.rowSpan = 2
    node("table", {}, [
      node("thead", {}, [row(["Permission", "Visible state"], "th")]),
      node("tbody", {}, [
        node("tr", {}, [spanning, node("td", { textContent: "None" })]),
        node("tr", {}, [target, node("td", { textContent: "extra" })]),
      ]),
    ])
    expect(labels(target)).toEqual({ rowLabel: "", columnLabel: "" })
    const plain = node("td", { textContent: "Drive" })
    node("table", {}, [
      node("thead", {}, [row(["Permission", "Visible state", "Database evidence"], "th")]),
      node("tbody", {}, [
        node("tr", {}, [
          node("td", { textContent: "Media & Apple Music" }),
          node("td", { rowspan: "", textContent: "4 apps" }),
          plain,
        ]),
      ]),
    ])
    expect(labels(plain)).toEqual({ rowLabel: "Media & Apple Music", columnLabel: "Database evidence" })
  })

  test("bounds every string it puts on the wire, reads only its own table, and ignores non-cells", () => {
    const long = "x".repeat(1000)
    const target = node("td", { textContent: long })
    node("table", {}, [node("thead", {}, [row(["Permission", long], "th")]), node("tbody", {}, [row([long, target])])])
    const result = tableCellTarget(target, () => long)!
    expect([result.rowLabel.length, result.columnLabel.length, result.text.length, result.selector.length]).toEqual([
      240, 240, 240, 240,
    ])

    const inner = node("td", { textContent: "4 apps" })
    const nested = node("table", {}, [
      node("tbody", {}, [
        node("tr", {}, [node("td", { rowspan: "2", textContent: "nested span" }), node("td", { textContent: "a" })]),
        node("tr", {}, [node("td", { textContent: "b" })]),
      ]),
    ])
    node("table", {}, [
      node("thead", {}, [row(["Permission", "Visible state"], "th")]),
      node("tbody", {}, [row([node("td", { textContent: "Media & Apple Music" }, [nested]), inner])]),
    ])
    expect(labels(inner)).toEqual({ rowLabel: "Media & Apple Music", columnLabel: "Visible state" })

    const p = node("p", { textContent: "not a cell" })
    node("div", {}, [p])
    expect(tableCellTarget(p, () => "")).toBeNull()
  })
})

describe("naming a Mermaid node", () => {
  const label = (text: string, multiline = false) => {
    if (!multiline) return el("span", { className: "nodeLabel", text })
    const [a, b] = text.split(" ")
    return el("span", {
      className: "nodeLabel",
      children: [el("p", { children: [el("span", { text: a }), el("br"), el("span", { text: b })] })],
    })
  }
  const diagram = (opts: { nodeId?: string; labelText?: string; multiline?: boolean } = {}) => {
    const labelEl = label(opts.labelText ?? "HomeAgentChat", opts.multiline)
    const rect = el("rect")
    const g = el("g", {
      id: opts.nodeId ?? "mermaid-7-flowchart-HomeAgentChat-1",
      className: "node",
      children: [rect, labelEl],
    })
    const svg = el("svg", { id: "mermaid-7", children: [g] })
    return { svg, g, rect, labelEl }
  }

  test("recognises Mermaid's own output markers, and our opt-in wrapper as well as lavish's", () => {
    expect(isMermaidSvg(el("svg", { id: "mermaid-1782877720504" }))).toBe(true)
    expect(isMermaidSvg(el("svg", { id: "mermaid_underscore" }))).toBe(true)
    expect(isMermaidSvg(el("svg", { attrs: { "aria-roledescription": "flowchart-v2" } }))).toBe(true)
    const inClass = el("svg")
    el("div", { className: "mermaid", children: [inClass] })
    expect(isMermaidSvg(inClass)).toBe(true)
    const ours = el("svg")
    el("figure", { attrs: { "data-redcode-mermaid": "" }, children: [ours] })
    expect(isMermaidSvg(ours)).toBe(true)
    const theirs = el("svg")
    el("figure", { attrs: { "data-lavish-mermaid": "" }, children: [theirs] })
    expect(isMermaidSvg(theirs)).toBe(true)
    expect(isMermaidSvg(el("svg", { id: "logo" }))).toBe(false)
    expect(isMermaidSvg(null)).toBe(false)
  })

  test("reads a label as one line: <br> becomes a space, whitespace collapses, 120 chars at most", () => {
    expect(readNodeLabel(label("HomeAgentChat"))).toBe("HomeAgentChat")
    expect(readNodeLabel(label("AnonDiagnosisChat 2415LOC", true))).toBe("AnonDiagnosisChat 2415LOC")
    expect(readNodeLabel(el("span", { text: "  a   b  " }))).toBe("a b")
    expect(readNodeLabel(el("span", { text: "x".repeat(200) })).length).toBe(120)
    expect(readNodeLabel(null)).toBe("")
  })

  test("resolves the <g> from an inner shape, and nothing outside a Mermaid node", () => {
    const { rect, g } = diagram()
    expect(mermaidNodeElement(rect)).toBe(g)
    expect(mermaidNodeElement(g)).toBe(g)
    expect(mermaidNodeElement(null)).toBeNull()
    expect(mermaidNodeElement(el("g", { className: "node" }))).toBeNull()
    const foreign = el("g", { id: "n1", className: "node" })
    el("svg", { id: "hand-drawn", children: [foreign] })
    expect(mermaidNodeElement(foreign)).toBeNull()
  })

  test("anchors a node to the diagram's ids and its rendered label", () => {
    const { rect } = diagram()
    expect(mermaidNodeFrom(rect, (n) => "g#" + n.id)).toEqual({
      type: "mermaid-node",
      diagramId: "mermaid-7",
      nodeId: "mermaid-7-flowchart-HomeAgentChat-1",
      label: "HomeAgentChat",
      selector: "g#mermaid-7-flowchart-HomeAgentChat-1",
    })
    const { rect: multi } = diagram({ labelText: "useWorkflowChat 1198LOC", multiline: true })
    expect(mermaidNodeFrom(multi, () => "")!.label).toBe("useWorkflowChat 1198LOC")
    const svg = el("svg", { id: "mermaid-7", children: [el("g", { className: "edgePaths" })] })
    expect(mermaidNodeFrom(svg.children[0]!, () => "")).toBeNull()
  })
})
