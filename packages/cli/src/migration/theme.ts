import { Schema } from "effect"
import { parseThemeDocument } from "@opencode/theme/tui"
import { migrateV1 } from "@opencode/theme/tui/import"

const Color = Schema.Union([Schema.String, Schema.Number, Schema.Struct({ dark: Schema.String, light: Schema.String })])
const HistoricalTheme = Schema.Struct({
  $schema: Schema.String.pipe(Schema.optional),
  defs: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  theme: Schema.Struct({
    primary: Color,
    secondary: Color,
    accent: Color,
    error: Color,
    warning: Color,
    success: Color,
    info: Color,
    text: Color,
    textMuted: Color,
    selectedListItemText: Color.pipe(Schema.optional),
    background: Color,
    backgroundPanel: Color,
    backgroundElement: Color,
    backgroundMenu: Color.pipe(Schema.optional),
    border: Color,
    borderActive: Color,
    borderSubtle: Color,
    diffAdded: Color,
    diffRemoved: Color,
    diffContext: Color,
    diffHunkHeader: Color,
    diffHighlightAdded: Color,
    diffHighlightRemoved: Color,
    diffAddedBg: Color,
    diffRemovedBg: Color,
    diffContextBg: Color,
    diffLineNumber: Color,
    diffAddedLineNumberBg: Color,
    diffRemovedLineNumberBg: Color,
    markdownText: Color,
    markdownHeading: Color,
    markdownLink: Color,
    markdownLinkText: Color,
    markdownCode: Color,
    markdownBlockQuote: Color,
    markdownEmph: Color,
    markdownStrong: Color,
    markdownHorizontalRule: Color,
    markdownListItem: Color,
    markdownListEnumeration: Color,
    markdownImage: Color,
    markdownImageText: Color,
    markdownCodeBlock: Color,
    syntaxComment: Color,
    syntaxKeyword: Color,
    syntaxFunction: Color,
    syntaxVariable: Color,
    syntaxString: Color,
    syntaxNumber: Color,
    syntaxType: Color,
    syntaxOperator: Color,
    syntaxPunctuation: Color,
    thinkingOpacity: Schema.Finite.pipe(Schema.optional),
  }),
})
const decode = Schema.decodeUnknownSync(HistoricalTheme, { onExcessProperty: "error" })

export function convertTheme(input: unknown) {
  if (typeof input === "object" && input !== null && "theme" in input)
    return parseThemeDocument(migrateV1(decode(input)))
  return parseThemeDocument(input)
}
