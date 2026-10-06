/// <reference lib="dom" />
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { parseHTML } from "linkedom"
import { Design } from "@opencode/schema/design"
import { DesignFiles } from "../src/design/files"
import { DesignQuality } from "../src/design/quality"
import { DesignReuse } from "../src/design/reuse"
import { DesignSignature } from "../src/design/signature"
import { tmpdir } from "./fixture/tmpdir"

/** linkedom has no layout engine: computed style is read from each element's inline style, with page defaults. */
const reader = (element: Element): DesignSignature.Style => {
  const declared = Object.fromEntries(
    (element.getAttribute("style") ?? "")
      .split(";")
      .map((part) => part.split(":"))
      .filter((part) => part.length >= 2)
      .map(([name, ...value]) => [name!.trim(), value.join(":").trim()]),
  )
  return {
    display: declared.display ?? "block",
    gridTemplateColumns: declared["grid-template-columns"] ?? "none",
    flexDirection: declared["flex-direction"] ?? "row",
    color: declared.color ?? "rgb(17, 24, 39)",
    backgroundColor: declared["background-color"] ?? "rgba(0, 0, 0, 0)",
    fontFamily: declared["font-family"] ?? "Inter, sans-serif",
  }
}

interface Copy {
  readonly brand: string
  readonly nav: readonly string[]
  readonly title: string
  readonly lead: string
  readonly card: string
  readonly action: string
  readonly legal: string
}
const english: Copy = {
  brand: "Northwind",
  nav: ["Home", "Products", "Contact"],
  title: "Seasonal collection",
  lead: "Hand-picked goods for the colder months, shipped from our own workshop within two working days.",
  card: "Wool scarf",
  action: "Add to cart",
  legal: "All prices include tax.",
}
const japanese: Copy = {
  brand: "ノースウィンド",
  nav: ["ホーム", "商品", "お問い合わせ"],
  title: "季節のコレクション",
  lead: "寒い季節のために厳選した品々を、自社の工房から二営業日以内にお届けします。",
  card: "ウールのマフラー",
  action: "カートに追加",
  legal: "表示価格はすべて税込みです。",
}
const portuguese: Copy = {
  brand: "Vento Norte",
  nav: ["Início", "Produtos", "Contato"],
  title: "Coleção da estação",
  lead: "Peças escolhidas à mão para os meses frios, enviadas da nossa oficina em até dois dias úteis.",
  card: "Cachecol de lã",
  action: "Adicionar ao carrinho",
  legal: "Todos os preços incluem impostos.",
}

const storefront = (id: string, copy: Copy, accent = "rgb(37, 99, 235)") =>
  `<div data-design-variant="${id}" class="shell"><header style="display:flex"><a class="brand">${copy.brand}</a><nav style="display:flex">${copy.nav.map((item) => `<a class="link">${item}</a>`).join("")}</nav></header><main><section class="hero"><h1>${copy.title}</h1><p>${copy.lead}</p></section><section style="display:grid;grid-template-columns:repeat(3, 1fr)">${[1, 2, 3]
    .map(
      (index) =>
        `<article class="card"><h2>${copy.card} ${index}</h2><p>${copy.lead.slice(0, 30)}</p><button style="background-color:${accent}">${copy.action}</button></article>`,
    )
    .join("")}</section></main><footer><p>${copy.legal}</p></footer><script>ignored()</script></div>`

const dashboard = (id: string, copy: Copy) =>
  `<div data-design-variant="${id}" style="display:flex"><aside><nav><ul>${copy.nav.map((item) => `<li><a>${item}</a></li>`).join("")}<li><a>${copy.card}</a></li></ul></nav></aside><main style="display:flex;flex-direction:column"><div class="toolbar" style="display:flex"><h1>${copy.title}</h1><button>${copy.action}</button></div><table><thead><tr>${[1, 2, 3, 4].map((index) => `<th>${copy.nav[index % 3]}</th>`).join("")}</tr></thead><tbody>${[1, 2, 3]
    .map(() => `<tr>${[1, 2, 3, 4].map(() => `<td>${copy.card}</td>`).join("")}</tr>`)
    .join("")}</tbody></table><form style="display:grid;grid-template-columns:1fr 1fr"><label>${copy.brand}<input></label><label>${copy.legal}<input></label></form></main></div>`

const page = (body: string) => parseHTML(`<!doctype html><html><body>${body}</body></html>`).document as unknown as Document
const sign = (body: string, variant: string | null) => DesignSignature.capture(variant, page(body), reader)
const entries = (body: string, variants: readonly string[]) =>
  variants.map((variant) => ({ variant, width: 1440, signature: sign(body, variant) }))
const alike = (a: string, b: string) => DesignSignature.similarity(DesignSignature.parse(a)!, DesignSignature.parse(b)!)

describe("DesignSignature", () => {
  test("is stable for one rendering and reads structure, not copy", () => {
    const body = storefront("calm", english)
    const signature = sign(body, "calm")
    expect(signature).toBe(sign(body, "calm"))
    expect(signature).toStartWith("v2;L=header.nav.main.section*2.article*3.footer;C=f2.f3.g3;H=1.3.0.0.0.0;")
    expect(signature).not.toContain("Northwind")
    // Scripts and hidden subtrees are not part of what the reviewer sees.
    expect(sign(body.replace("<footer>", '<footer style="display:none">'), "calm")).toContain("L=header.nav.main.section*2.article*3;")
  })

  test("scores identical, translated and genuinely different directions apart", () => {
    const base = sign(storefront("a", english), "a")
    expect(alike(base, base)).toEqual({ structure: 1, paint: 1, score: 1 })
    const translated = alike(base, sign(storefront("a", japanese), "a"))
    expect(translated.structure).toBeGreaterThanOrEqual(DesignSignature.THRESHOLD.variants)
    const different = alike(base, sign(dashboard("a", english), "a"))
    expect(different.structure).toBeLessThan(0.6)
  })

  test("flags a direction that repeats another, whatever language its copy is in", () => {
    const rule = (checks: readonly Design.AuditCheck[]) => checks.map((check) => [check.rule, check.key, check.variant])
    const english3 = entries(storefront("calm", english) + storefront("bold", english, "rgb(220, 38, 38)") + dashboard("dense", english), [
      "calm",
      "bold",
      "dense",
    ])
    const mixed = entries(storefront("calm", japanese) + storefront("bold", portuguese, "rgb(220, 38, 38)") + dashboard("dense", japanese), [
      "calm",
      "bold",
      "dense",
    ])
    const flagged = DesignSignature.repeated(english3)
    expect(rule(flagged)).toEqual([["variants-too-similar", "variants-too-similar@calm~bold", "bold"]])
    expect(flagged[0]!.severity).toBe("review")
    expect(flagged[0]!.selector).toBe('[data-design-variant="bold"]')
    expect(rule(DesignSignature.repeated(mixed))).toEqual(rule(flagged))
    // Directions too small to judge are never compared.
    expect(DesignSignature.repeated(entries('<div data-design-variant="x"><p>a</p></div><div data-design-variant="y"><p>b</p></div>', ["x", "y"]))).toEqual([])
  })

  test("matches an approved design of another design only, and keeps the newest approvals on disk", async () => {
    await using tmp = await tmpdir()
    const own = entries(storefront("calm", english), ["calm"])
    expect(await DesignSignature.approved(tmp.path)).toEqual({ designs: [] })
    await DesignSignature.record(tmp.path, {
      design: "design_shop",
      name: "Shop",
      revision: "rev_shop",
      variant: "grid",
      signature: sign(storefront("grid", portuguese), "grid"),
      width: 1440,
      approved: 1,
    })
    await DesignSignature.record(tmp.path, {
      design: "design_admin",
      name: "Admin",
      revision: "rev_admin",
      signature: sign(dashboard("table", english), "table"),
      width: 1440,
      approved: 2,
    })
    const approved = (await DesignSignature.approved(tmp.path)).designs
    expect(approved.map((item) => item.design)).toEqual(["design_admin", "design_shop"])
    expect(await Bun.file(path.join(tmp.path, DesignSignature.FILE)).json()).toMatchObject({ version: DesignSignature.FORMAT })
    const found = DesignSignature.matches(own, approved, "design_new")
    expect(found.checks.map((check) => check.key)).toEqual(["matches-approved-design@calm~design_shop"])
    expect(found.checks[0]!.evidence).toContain('approved design "Shop"')
    expect(found.skipped).toBe(0)
    expect(DesignSignature.matches(own, approved, "design_shop").checks).toEqual([])
    expect(DesignSignature.chosen([{ signature: "page" }, { variant: "grid", signature: "grid" }], "grid")?.signature).toBe("grid")
    expect(DesignSignature.chosen([{ variant: "grid", signature: "grid" }], "other")?.signature).toBe("grid")
  })

  test("compares an approved signature only at the width it was taken at", () => {
    const signature = sign(storefront("grid", english), "grid")
    const approval = { design: "design_shop", name: "Shop", revision: "rev_shop", signature, approved: 1 }
    const own = [{ variant: "calm", width: 1440, signature }]
    expect(DesignSignature.matches(own, [{ ...approval, width: 1440 }], "design_new").checks).toHaveLength(1)
    // Another width, or an approval recorded before widths were kept, is skipped and counted.
    expect(DesignSignature.matches(own, [{ ...approval, width: 390 }], "design_new")).toEqual({ checks: [], skipped: 1 })
    expect(DesignSignature.matches(own, [approval], "design_new")).toEqual({ checks: [], skipped: 1 })
    // Directions signed at different widths are not compared with each other either.
    expect(DesignSignature.repeated([{ variant: "a", width: 390, signature }, { variant: "b", width: 1440, signature }])).toEqual([])
  })

  test("never overwrites an unreadable or newer signature file, and serializes concurrent approvals", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, DesignSignature.FILE)
    const approval = (design: string, approved: number) => ({
      design,
      name: design,
      revision: `rev_${design}`,
      signature: sign(storefront("grid", english), "grid"),
      width: 1440,
      approved,
    })
    // Two approvals in the same process both land: each write reads the other's result.
    await Promise.all([DesignSignature.record(tmp.path, approval("a", 1)), DesignSignature.record(tmp.path, approval("b", 2))])
    expect((await DesignSignature.approved(tmp.path)).designs.map((item) => item.design).toSorted()).toEqual(["a", "b"])
    const newer = JSON.stringify({ version: DesignSignature.FORMAT + 1, designs: [], future: true })
    await Bun.write(file, newer)
    expect(await DesignSignature.record(tmp.path, approval("c", 3))).toEqual({ kept: expect.stringContaining("newer format") })
    expect(await Bun.file(file).text()).toBe(newer)
    expect((await DesignSignature.approved(tmp.path)).problem).toContain("newer format (2)")
    await Bun.write(file, "{ not json")
    expect((await DesignSignature.record(tmp.path, approval("c", 3))).kept).toContain("unreadable")
    expect(await Bun.file(file).text()).toBe("{ not json")
  })

  test("does not call two different layouts made of plain boxes alike, but still catches an identical one", () => {
    const boxes = (count: number, depth: number) =>
      `<div>${Array.from({ length: count }, (_, index) => `<div>${"<div>".repeat(depth)}<span>Item ${index}</span>${"</div>".repeat(depth)}</div>`).join("")}</div>`
    const kanban = `<div data-design-variant="kanban">${boxes(4, 3)}${boxes(4, 3)}</div>`
    const chat = `<div data-design-variant="chat">${boxes(12, 1)}<div><span>Type a message</span></div></div>`
    const different = entries(kanban + chat, ["kanban", "chat"])
    expect(alike(different[0]!.signature, different[1]!.signature).structure).toBe(0)
    expect(DesignSignature.repeated(different)).toEqual([])
    const copy = kanban.replace('data-design-variant="kanban"', 'data-design-variant="copy"')
    expect(DesignSignature.repeated(entries(kanban + copy, ["kanban", "copy"])).map((check) => check.key)).toEqual([
      "variants-too-similar@kanban~copy",
    ])
  })

  test("signs a translated clone by its rendered text width, so it still matches the original", () => {
    const base = sign(storefront("a", english), "a")
    for (const copy of [japanese, portuguese]) {
      const translated = alike(base, sign(storefront("a", copy), "a"))
      expect(translated.structure).toBeGreaterThanOrEqual(DesignSignature.THRESHOLD.approved.structure)
      expect(translated.score).toBeGreaterThanOrEqual(DesignSignature.THRESHOLD.approved.score)
    }
  })
})

const inventory: Design.Component[] = [
  { root: "src/components/ui", file: "src/components/ui/button.tsx", name: "Button", props: "ButtonProps" },
  { root: "src/components/ui", file: "src/components/ui/card.tsx", name: "Card" },
  { root: "src/components/ui", file: "src/components/ui/card.tsx", name: "CardHeader" },
  { root: "src/components/ui", file: "src/components/ui/dialog.tsx", name: "Dialog" },
]
const theme = DesignReuse.tokens(
  ":root { --primary: #2563EB; --surface: rgb(248, 250, 252); --danger: #dc2626 } body { font-family: 'Inter', system-ui, sans-serif }",
)

describe("DesignReuse", () => {
  test("flags a component re-declared under a design-system name and measures reuse", () => {
    const result = DesignReuse.check({
      engine: "react",
      inventory,
      tokens: undefined,
      aliases: { "@/": "./src/" },
      width: 1440,
      files: [
        {
          file: "src/main.tsx",
          text: [
            'import { Button } from "@/components/ui/button"',
            'import { Dialog as Modal } from "../../src/components/ui/dialog"',
            "",
            "function Card(props: { title: string }) {",
            "  return <section>{props.title}</section>",
            "}",
            "const Panel = () => <Card title='x' />",
          ].join("\n"),
        },
      ],
    })
    expect(result.checks.map((check) => [check.rule, check.key, check.selector])).toEqual([
      ["redeclared-component", "redeclared-component@Card", "source src/main.tsx:4"],
    ])
    expect(result.checks[0]!.fix).toContain('import { Card } from "@/components/ui/card"')
    expect(result.reuse).toEqual({
      imported: ["Button", "Dialog"],
      redeclared: ["Card"],
      files: ["src/components/ui/button.tsx", "src/components/ui/dialog.tsx"],
      ratio: 2 / 3,
    })
    expect(DesignReuse.describe(result.reuse!)).toBe(
      "Design-system reuse: 2 components imported (Button, Dialog) from 2 files; 1 re-declared (Card); reuse 67%.",
    )
    // An HTML prototype cannot import components, so nothing is re-declared.
    expect(DesignReuse.check({ engine: "html", inventory, tokens: undefined, width: 1440, files: [{ file: "index.html", text: "<script>function Card(){}</script>" }] })).toEqual({ checks: [] })
  })

  test("flags literal colors and fonts the design system does not declare, conservatively", () => {
    const result = DesignReuse.check({
      engine: "react",
      inventory: [],
      tokens: theme,
      width: 1440,
      files: [
        {
          file: "src/styles.css",
          text: "/* #abcdef in a comment */ .hero { color: #2563eb; background: #FF00AA; border-color: rgb(248 250 252); box-shadow: 0 1px rgba(0,0,0,.2); font-family: 'Comic Sans MS', cursive } .x { color: #fff; font-family: Inter }",
        },
        {
          file: "src/main.tsx",
          text: 'export const A = () => <a href="#add" className="bg-[#123456] text-[#2563eb]" style={{ fontFamily: "var(--font-sans)" }}>Add</a>',
        },
      ],
    })
    expect(result.checks.map((check) => check.key)).toEqual([
      "color-off-token@#ff00aa",
      "color-off-token@#123456",
      "font-off-system@comic sans ms",
    ])
    expect(result.checks.every((check) => check.severity === "review")).toBe(true)
    // Without declared tokens there is nothing to call a literal off-token.
    const bare = DesignReuse.check({
      engine: "react",
      inventory: [],
      tokens: DesignReuse.tokens(""),
      width: 1440,
      files: [{ file: "a.css", text: ".a { color: #ff00aa; font-family: Lobster }" }],
    })
    expect(bare.checks).toEqual([])
  })

  test("needs a component shape for a re-declaration and a design-system path for an import", () => {
    const result = DesignReuse.check({
      engine: "react",
      inventory: [...inventory, { root: "src/components/ui", file: "src/components/ui/status.tsx", name: "Status" }],
      tokens: undefined,
      width: 1440,
      files: [
        {
          file: "src/main.tsx",
          text: [
            'import { Card } from "./card"',
            'import { CardHeader } from "src/components/ui/card"',
            "const Status = { open: 1, closed: 2 } as const",
            "const Dialog = forwardRef((props, ref) => null)",
            "export function Button<T>(items: Array<T>) {",
            "  return items.length",
            "}",
          ].join("\n"),
        },
        { file: "src/card.tsx", text: "export const Card = ({ title }: { title: string }) => <section>{title}</section>" },
      ],
    })
    // A capitalized constant and a generic helper are not components; a component factory and an arrow returning JSX are.
    expect(result.checks.map((check) => check.key)).toEqual(["redeclared-component@Dialog", "redeclared-component@Card"])
    // `./card` is a local file even though a design-system path ends with card; the bare project path is the system's.
    expect(result.reuse?.imported).toEqual(["CardHeader"])
    expect(result.reuse?.redeclared).toEqual(["Dialog", "Card"])
  })

  test("resolves a relative import through the design root", () => {
    const at = (spec: string, base?: string) =>
      DesignReuse.check({
        engine: "react",
        inventory,
        tokens: undefined,
        width: 1440,
        base,
        files: [{ file: "src/main.tsx", text: `import { Button } from "${spec}"` }],
      }).reuse?.imported
    // From design/proto/src/main.tsx, three levels up is the application root.
    expect(at("../../../src/components/ui/button", "design/proto")).toEqual(["Button"])
    // A copy inside the prototype is not the design system's, with or without the design root.
    expect(at("./components/ui/button", "design/proto")).toEqual([])
    expect(at("./components/ui/button")).toEqual([])
    expect(at("../../../src/components/ui/button")).toEqual(["Button"])
  })

  test("compares colors in one canonical form and needs real color tokens before flagging", () => {
    const shadcn = DesignReuse.tokens(":root { --radius: 0.5rem; --muted: 220 14% 96%; --primary: 221.2 83.2% 53.3%; --ring: #dc2626 }")
    expect(shadcn.declaresColors).toBe(true)
    expect(DesignReuse.color("hsl(220 14% 96%)")).toBe(DesignReuse.color("hsl(220deg, 14%, 96%, 0.4)"))
    expect(DesignReuse.color("rgba(37, 99, 235, 0.5)")).toBe("#2563eb")
    expect(DesignReuse.color("#2563eb80")).toBe("#2563eb")
    expect(DesignReuse.color("oklch(70% 0.1 240 / 50%)")).toBe(DesignReuse.color("oklch(0.7 0.1 240)"))
    expect(DesignReuse.color("rgb(from red r g b)")).toBeUndefined()
    const flagged = (tokens: ReturnType<typeof DesignReuse.tokens>, text: string) =>
      DesignReuse.check({ engine: "react", inventory: [], tokens, width: 1440, files: [{ file: "a.css", text }] }).checks.map(
        (check) => check.key,
      )
    expect(
      flagged(shadcn, ".a { background: hsl(220 14% 96%); color: hsl(220 14% 96% / 0.5); border-color: rgb(37 99 235 / 20%) } .b { color: #ff00aa }"),
    ).toEqual(["color-off-token@#ff00aa"])
    // Only a radius and a spacing scale: no colors are declared, so no literal color is off-token.
    expect(flagged(DesignReuse.tokens(":root { --radius: 0.5rem; --space-2: 8px }"), ".a { color: #ff00aa }")).toEqual([])
  })

  test("notes native controls the design system wraps, at info severity", () => {
    const result = DesignReuse.check({
      engine: "react",
      inventory,
      tokens: undefined,
      width: 1440,
      files: [{ file: "src/main.tsx", text: "export const A = () => <div>\n<button>a</button><button>b</button><input /></div>" }],
    })
    expect(result.checks.map((check) => [check.key, check.severity, check.selector])).toEqual([
      ["native-element@button", "info", "source src/main.tsx:2"],
    ])
    expect(result.checks[0]!.evidence).toStartWith("2 native <button> elements")
  })

  test("stays linear on large sources and reports what its bounds left out", async () => {
    await using tmp = await tmpdir()
    const big = Array.from({ length: 13_000 }, (_, index) => `export const a${index} = 1`).join("\n")
    const sheet = Array.from({ length: 6_000 }, (_, index) => `.c${index} { color: #${(index * 2_731).toString(16).padStart(6, "0").slice(-6)} }`).join("\n")
    const components = Array.from({ length: 800 }, (_, index) => ({
      root: "src/components/ui",
      file: `src/components/ui/c${index}.tsx`,
      name: `C${index}`,
    }))
    const files = [
      { file: "src/big.ts", text: big },
      { file: "src/styles.css", text: sheet },
      ...Array.from({ length: 200 }, (_, file) => ({
        file: `src/page${file}.tsx`,
        text: Array.from({ length: 15 }, (_, index) => `import { C${index} } from "@/components/ui/c${index}"`).join("\n"),
      })),
    ]
    const started = performance.now()
    const result = DesignReuse.check({ engine: "react", inventory: components, tokens: theme, aliases: { "@/": "./src/" }, width: 1440, files, skipped: 3 })
    expect(performance.now() - started).toBeLessThan(1_500)
    expect(result.reuse?.imported).toHaveLength(15)
    expect(result.checks.filter((check) => check.rule === "color-off-token")).toHaveLength(6)
    expect(result.checks.find((check) => check.rule === "color-off-token")!.evidence).toContain("(line 2)")
    expect(result.checks.find((check) => check.key === "reuse-scan-limit")).toMatchObject({ severity: "info" })
    // read() counts what its bounds leave out: a file over the per-file bound here.
    const small = new TextEncoder().encode("export const A = 1")
    const large = new Uint8Array(DesignReuse.LIMITS.bytes + 1)
    await Bun.write(path.join(tmp.path, DesignFiles.hash(small)), small)
    await Bun.write(path.join(tmp.path, DesignFiles.hash(large)), large)
    const read = await DesignReuse.read(tmp.path, { "a.ts": DesignFiles.hash(small), "b.ts": DesignFiles.hash(large) })
    expect(read.files.map((item) => item.file)).toEqual(["a.ts"])
    expect(read.skipped).toBe(1)
  })
})

describe("DesignQuality.settle", () => {
  const check = (rule: string, extra: Partial<Design.AuditCheck> = {}): Design.AuditCheck => ({
    rule,
    severity: "review",
    selector: "body > h1:nth-child(1)",
    evidence: "Signal.",
    fix: "Fix.",
    width: 1440,
    ...extra,
  })

  test("keys every check, keeps accepted exceptions from being flagged again and respects the design system's own effects", () => {
    const checks = [
      check("gradient-heading", { variant: "calm" }),
      check("gradient-heading", { variant: "calm", width: 390 }),
      check("placeholder-link"),
      check("redeclared-component", { key: "redeclared-component@Card", selector: "source src/main.tsx:4" }),
    ]
    const decisions = [
      { id: DesignQuality.accepted("redeclared-component@Card"), text: "The local Card wraps a chart and composes the system Card." },
      { id: "direction-calm", text: "Calm direction." },
    ]
    const first = DesignQuality.settle(checks, decisions)
    expect(first.checks.map((item) => item.key)).toEqual([
      "gradient-heading@calm:body > h1:nth-child(1)",
      "gradient-heading@calm:body > h1:nth-child(1)",
      "placeholder-link@page:body > h1:nth-child(1)",
    ])
    expect(first.findings).toEqual(["1 accepted exception recorded in decisions not flagged again: redeclared-component@Card."])
    // A later audit with the same finding still leaves it out.
    expect(DesignQuality.settle([checks[3]!], decisions).checks).toEqual([])
    const declared = DesignQuality.settle(checks, [], { gradient: true, glass: false })
    expect(declared.checks.filter((item) => item.rule === "gradient-heading").map((item) => item.severity)).toEqual(["info", "info"])
    expect(declared.checks.find((item) => item.rule === "placeholder-link")?.severity).toBe("review")
  })
})
