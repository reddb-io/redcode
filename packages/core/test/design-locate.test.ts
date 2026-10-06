/// <reference lib="dom" />
import { describe, expect, test } from "bun:test"
import { parseHTML } from "linkedom"
import { DesignLocate } from "../src/design/locate"

const page = (body: string) => parseHTML(`<!doctype html><html><body>${body}</body></html>`).document

const header = (position: number) =>
  `<button data-design-id="user-menu-${position}"><svg data-icon="${position}"></svg>Filipe</button>`
const row = (position: number) =>
  `<tr data-design-id="clients-row"><td>Client ${position}</td><td><button data-design-id="clients-rotate">Rotate ${position}</button></td></tr>`
const rendered = page(
  `<div data-design-variant="console"><header data-design-id="console-topbar">${[1, 2, 3].map(header).join("")}</header><main data-design-id="console-main"><table><tbody>${[1, 2, 3].map(row).join("")}</tbody></table></main></div><div data-design-variant="other"><button data-design-id="clients-rotate">Other</button></div><footer><a data-design-id="legal">Legal</a></footer>`,
)

const resolve = (target: string, variant = "console", xpath = "") => {
  const hit = DesignLocate.resolve(rendered as never, { target, xpath, variant })
  return hit.found ? { how: hit.how, text: hit.node.textContent, icon: hit.node.getAttribute("data-icon") } : hit
}

describe("DesignLocate.resolve", () => {
  test("resolves an unkeyed child of a keyed ancestor, not the ancestor", () => {
    expect(resolve('variant:console [data-design-id="user-menu-2"] > svg:nth-of-type(1)')).toEqual({
      how: "selector",
      text: "",
      icon: "2",
    })
  })

  test("tells a repeated id apart by its row's position, not the first row", () => {
    expect(
      resolve('variant:console tr[data-design-id="clients-row"]:nth-of-type(3) [data-design-id="clients-rotate"]'),
    ).toEqual({ how: "data-design-id", text: "Rotate 3", icon: null })
  })

  test("resolves a plain id within its variant root", () => {
    expect(resolve('[data-design-id="clients-rotate"]', "other")).toEqual({
      how: "data-design-id",
      text: "Other",
      icon: null,
    })
    expect(resolve('variant:console [data-design-id="user-menu-1"]')).toEqual({
      how: "data-design-id",
      text: "Filipe",
      icon: null,
    })
  })

  test("falls back to the element's own id when its ancestors changed", () => {
    expect(resolve('section[data-design-id="moved"] > button[data-design-id="user-menu-3"]')).toEqual({
      how: "data-design-id",
      text: "Filipe",
      icon: null,
    })
  })

  test("never falls back to a repeated id or an ancestor's id when the full selector misses", () => {
    expect(resolve('tr[data-design-id="clients-row"]:nth-of-type(9)')).toEqual({ found: false, how: "not found" })
    expect(resolve('[data-design-id="user-menu-2"] > img')).toEqual({ found: false, how: "not found" })
  })

  test("finds an element outside every variant and reports a missing variant", () => {
    expect(resolve('[data-design-id="legal"]')).toEqual({ how: "data-design-id", text: "Legal", icon: null })
    expect(resolve('[data-design-id="legal"]', "missing")).toEqual({ found: false, how: "variant missing" })
  })

  test("resolves a page note to the variant root or the body, and leaves diagram and invalid selectors unresolved", () => {
    expect(resolve("page")).toMatchObject({ how: "page" })
    expect(resolve("page", "console")).toMatchObject({ how: "page" })
    expect(resolve("page", "missing")).toEqual({ found: false, how: "variant missing" })
    expect(resolve("diagram")).toEqual({ found: false, how: "not found" })
    expect(resolve("button[[", "console", "/html/body/div[1]")).toEqual({ found: false, how: "not found" })
  })

  test("runs from its serialized source, as the page receives it", () => {
    const serialized: typeof DesignLocate.resolve = new Function(`return (${DesignLocate.resolve.toString()})`)()
    const hit = serialized(rendered as never, {
      target: 'variant:console tr[data-design-id="clients-row"]:nth-of-type(2) [data-design-id="clients-rotate"]',
      xpath: "",
      variant: "console",
    })
    expect(hit.found && hit.node.textContent).toBe("Rotate 2")
  })
})

describe("DesignLocate.facts", () => {
  const first = (html: string) => page(html).querySelector("#cta")!

  test("the verify marker never counts as a change; text, markup and style do", () => {
    const plain = DesignLocate.facts(first(`<button id="cta">  Enviar\n  agora </button>`), "color:red")
    expect(plain.text).toBe("Enviar agora")
    expect(DesignLocate.facts(first(`<button id="cta" data-redcode-verify="target">  Enviar\n  agora </button>`), "color:red")).toEqual(plain)
    expect(DesignLocate.facts(first(`<button id="cta">送信</button>`), "color:red").text).toBe("送信")
    expect(DesignLocate.facts(first(`<button id="cta" class="big">  Enviar\n  agora </button>`), "color:red").markup).not.toBe(plain.markup)
    expect(DesignLocate.facts(first(`<button id="cta">  Enviar\n  agora </button>`), "color:blue").markup).not.toBe(plain.markup)
  })
})
