import { expect, test } from "bun:test"
import path from "path"
import ts from "typescript"

const compatibilityAllowlist = [
  { reason: "package imports", pattern: /^@opencode-ai\// },
  { reason: "legacy environment variables", pattern: /^OPENCODE_[A-Z0-9_]+$/ },
  { reason: "legacy config and theme paths", pattern: /(?:^|[/.])\.?opencode(?:\.json|\/|$)/ },
  {
    reason: "internal protocol, provider, theme, and command identifiers",
    pattern:
      /^(?:opencode|opencode-go|opencode\.default|opencode\.(?:status|debug|mode)|opencode-plain-text|opencode-clipboard\.png|__opencode_custom_provider__|opencode-version)$/,
  },
  {
    reason: "real external OpenCode services",
    pattern: /(?:https?:\/\/|ghcr\.io\/)\S*opencode|(?:^|\s)opencode\.ai|\/opencode\b/,
  },
  { reason: "real external OpenCode provider names", pattern: /OpenCode (?:Zen|Go)\b/ },
] as const

test("user-visible branding uses Redcode", async () => {
  const root = path.resolve(import.meta.dir, "../src")
  const violations: string[] = []

  for await (const relative of new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: root })) {
    const source = ts.createSourceFile(
      relative,
      await Bun.file(path.join(root, relative)).text(),
      ts.ScriptTarget.Latest,
      true,
      relative.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    const visit = (node: ts.Node) => {
      const text =
        ts.isStringLiteralLike(node) || ts.isJsxText(node) || node.kind === ts.SyntaxKind.TemplateHead
          ? node.getText(source).replace(/^['"`]|['"`]$/g, "")
          : undefined
      if (text && /opencode/i.test(text) && !compatibilityAllowlist.some((item) => item.pattern.test(text))) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source))
        violations.push(`${relative}:${position.line + 1}: ${text.trim()}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  expect(violations).toEqual([])
})
