import { colorSchemes } from "@reddb-io/design-system/color"
import type { DesktopTheme, HexColor, ThemeVariant, V2ColorValue } from "../types"

/**
 * The built-in Redcode theme: the reddb.io Design System's Application Theme.
 *
 * Every color below is a role from the vendored design system (`--reddb-color-*`), resolved per Color Scheme by
 * `@reddb-io/design-system`. Nothing here is a raw color except the seeds, which only feed the engine's derived scales
 * (diff, syntax, markdown) that the design system has no role for; they are the design system's Brand stops at the
 * pinned release. Both variants share one set of references because the roles flip with `data-color-scheme`.
 *
 * `<html data-theme="application">` is always set (the design system Theme axis); `data-color-theme` names the active
 * color theme, which is this one by default.
 */
export const APPLICATION_THEME_ID = "application"

const role = (name: string) => `var(--reddb-color-${name})` as const
const ink = (percent: number, over = "transparent") =>
  `color-mix(in srgb, ${role("foreground")} ${percent}%, ${over})` as const
const mix = (a: string, percent: number, b = "transparent") => `color-mix(in srgb, ${a} ${percent}%, ${b})` as const

const foreground = role("foreground")
const background = role("background")
const muted = role("ink-muted")
const base = role("elevation-base-surface")
const raised = role("elevation-raised-surface")
const overlay = role("elevation-overlay-surface")
const sunken = role("elevation-sunken-surface")
const disabled = ink(38)
const feedback = (tone: "danger" | "info" | "success" | "warning", part: string) =>
  role(`feedback-${tone}-${part}`) as `var(--${string})`

const SEEDS = {
  light: {
    neutral: "#f4f5f7",
    ink: "#07080a",
    primary: "#ff2056",
    success: "#329556",
    warning: "#a47d18",
    error: "#ad163a",
    info: "#4586ca",
    interactive: "#305e8e",
    diffAdd: "#329556",
    diffDelete: "#d11a46",
  },
  dark: {
    neutral: "#12141b",
    ink: "#f4f5f7",
    primary: "#ff2056",
    success: "#4ade80",
    warning: "#fbbf24",
    error: "#ff7899",
    info: "#57a9ff",
    interactive: "#57a9ff",
    diffAdd: "#4ade80",
    diffDelete: "#ff6389",
  },
} satisfies Record<"light" | "dark", Record<string, HexColor>>

// Categorical identities, never the order of a list: build is the Brand red, the rest are the Series roles.
const agents = {
  build: role("primary"),
  plan: role("series-5"),
  explore: role("series-1"),
  review: feedback("success", "foreground"),
  writer: role("series-4"),
} as const

const agentTokens = Object.fromEntries(
  Object.entries(agents).flatMap(([name, color]) => [
    [`v2-agent-${name}-solid`, color],
    [`v2-agent-${name}-border`, mix(color, 24)],
    [`v2-agent-${name}-background`, mix(color, 8)],
  ]),
)

/** Layered fills: the design system has no ladder of greys, so a layer is Ink over the surface it sits on. */
const layers = (dark: boolean) => ({
  "v2-background-bg-layer-01": ink(dark ? 8 : 5, base),
  "v2-background-bg-layer-02": ink(dark ? 12 : 9, base),
  "v2-background-bg-layer-03": ink(dark ? 20 : 18, base),
  "v2-background-bg-layer-04": ink(dark ? 32 : 30, base),
})

/** A ramp from a Brand anchor: lighter steps lean on the paper, darker ones on the ink. */
const ramp = (name: string, light: string, dark: string, mid = light): Record<string, V2ColorValue> => {
  const white = role("neutral-0")
  const black = role("neutral-950")
  const steps: [number, string][] = [
    [100, mix(light, 14, white)],
    [200, mix(light, 26, white)],
    [300, mix(light, 44, white)],
    [400, dark],
    [500, mix(dark, 50, mid)],
    [600, mid],
    [700, mix(mid, 84, black)],
    [800, mix(mid, 68, black)],
    [900, mix(mid, 52, black)],
    [1000, mix(mid, 38, black)],
    [1100, mix(mid, 26, black)],
    [1200, mix(mid, 16, black)],
  ]
  return Object.fromEntries(steps.map(([step, value]) => [`v2-${name}-${step}`, value]))
}

const greys: Record<string, V2ColorValue> = {
  "v2-grey-50": role("neutral-0"),
  "v2-grey-100": role("neutral-50"),
  "v2-grey-200": role("neutral-100"),
  "v2-grey-300": mix(role("neutral-100"), 50, role("neutral-200")),
  "v2-grey-400": role("neutral-200"),
  "v2-grey-500": role("neutral-300"),
  "v2-grey-600": role("neutral-400"),
  "v2-grey-700": role("neutral-500"),
  "v2-grey-800": role("neutral-600"),
  "v2-grey-900": role("neutral-700"),
  "v2-grey-1000": role("neutral-800"),
  "v2-grey-1100": role("neutral-900"),
  "v2-grey-1200": role("neutral-950"),
}

const ramps: Record<string, V2ColorValue> = {
  ...greys,
  ...ramp("red", role("red-100"), role("red-400"), role("red-600")),
  ...ramp("orange", role("amber-100"), role("orange-400"), role("orange-600")),
  ...ramp("yellow", role("amber-100"), role("amber-400"), role("amber-600")),
  ...ramp("green", role("green-100"), role("green-400"), role("green-600")),
  ...ramp("cyan", role("blue-100"), role("teal-400"), role("teal-600")),
  ...ramp("blue", role("blue-100"), role("azure-400"), role("azure-600")),
  ...ramp("purple", role("blue-100"), role("violet-400"), role("violet-600")),
  ...ramp("pink", role("red-100"), role("magenta-400"), role("magenta-600")),
}

const semantics = (dark: boolean): Record<string, V2ColorValue> => ({
  ...ramps,
  ...layers(dark),
  "v2-background-bg-deep": sunken,
  "v2-background-bg-base": base,
  "v2-background-bg-inverse": foreground,
  "v2-background-bg-contrast": ink(dark ? 78 : 90, background),
  "v2-background-bg-icon-button-contrast": ink(dark ? 78 : 90, background),
  "v2-background-bg-button-neutral": dark ? ink(6) : raised,
  "v2-background-bg-accent": role("primary"),
  "v2-background-bg-code-path": feedback("info", "surface"),

  "v2-text-text-base": foreground,
  "v2-text-text-muted": muted,
  // Secondary text stays on `ink-muted`: the design system has no weaker ink that holds AA.
  "v2-text-text-faint": muted,
  "v2-text-text-inverse": background,
  "v2-text-text-contrast": background,
  // Accent copy is ink and links are ink with an underline; red means the primary action or an error.
  "v2-text-text-accent": role("primary-text"),
  "v2-text-text-accent-hover": foreground,
  "v2-text-text-code-accent": feedback("info", "foreground"),
  "v2-text-text-code-path": feedback("info", "foreground"),

  "v2-icon-icon-base": muted,
  "v2-icon-icon-muted": mix(muted, 72, background),
  "v2-icon-icon-faint": mix(muted, 52, background),
  "v2-icon-icon-inverse": background,
  "v2-icon-icon-contrast": background,
  "v2-icon-icon-accent": foreground,
  "v2-icon-icon-accent-hover": foreground,

  "v2-border-border-muted": role("muted"),
  "v2-border-border-base": role("elevation-base-border"),
  "v2-border-border-strong": role("control-edge"),
  "v2-border-border-inverse": foreground,
  "v2-border-border-focus": role("focus"),

  // Quiet-control states, per the design system: hover 8%, pressed 12% of the ink.
  "v2-overlay-simple-overlay-hover": ink(8),
  "v2-overlay-simple-overlay-pressed": ink(12),
  "v2-overlay-simple-overlay-contrast-hover": mix(background, 14),
  "v2-overlay-simple-overlay-contrast-pressed": mix(background, 24),
  "v2-overlay-simple-overlay-scrim": mix(role("scrim"), dark ? 60 : 40),
  "v2-overlay-gradient-depth-overlay-depth-top": background,
  "v2-overlay-gradient-depth-overlay-depth-bot": mix(background, 0),
  "v2-overlay-simple-tab-active-scrim": mix(base, 0),
  "v2-overlay-simple-tab-hover-scrim": mix(base, 0),
  "v2-overlay-simple-tab-scrim": mix(sunken, 0),

  "v2-state-bg-success": feedback("success", "surface"),
  "v2-state-fg-success": feedback("success", "foreground"),
  "v2-state-border-success": feedback("success", "border"),
  "v2-state-bg-warning": feedback("warning", "surface"),
  "v2-state-fg-warning": feedback("warning", "foreground"),
  "v2-state-border-warning": feedback("warning", "border"),
  "v2-state-bg-danger": feedback("danger", "surface"),
  "v2-state-fg-danger": feedback("danger", "foreground"),
  "v2-state-border-danger": feedback("danger", "border"),
  "v2-state-bg-info": feedback("info", "surface"),
  "v2-state-fg-info": feedback("info", "foreground"),
  "v2-state-border-info": feedback("info", "border"),

  // Session status marks. Waiting on the user is amber and live work is the running-badge blue; red
  // is kept for a failed turn, and an unseen finish is plain ink.
  "v2-status-attention": feedback("warning", "foreground"),
  "v2-status-working": feedback("info", "foreground"),
  "v2-status-queued": muted,
  "v2-status-failed": feedback("danger", "foreground"),
  "v2-status-done": foreground,

  ...agentTokens,

  "v2-elevation-raised": "var(--reddb-shadow-elevation-raised)",
  "v2-elevation-floating": "var(--reddb-shadow-elevation-overlay)",
  "v2-elevation-overlay": "var(--reddb-shadow-elevation-overlay)",
  "v2-elevation-button-neutral": `0 0 0 1px ${role("control-edge")}`,
  "v2-elevation-button-contrast": "none",
  "v2-elevation-elements": "none",
  "v2-elevation-switch-off": `inset 0 0 0 1px ${role("control-edge")}`,
  "v2-elevation-switch-on": "none",

  "v2-illustration-illustration-layer-01": ink(dark ? 10 : 6, base),
  "v2-illustration-illustration-layer-02": ink(dark ? 16 : 11, base),
  "v2-illustration-illustration-layer-03": ink(dark ? 26 : 20, base),
})

/** The legacy (non-v2) tokens the existing components still read. Unlisted ones stay engine-derived. */
const legacy = (dark: boolean): Record<string, string> => {
  const code = colorSchemes[dark ? "dark" : "light"]
  const hover = ink(8)
  const pressed = ink(12)
  return {
    "background-base": background,
    "background-weak": sunken,
    "background-strong": ink(4, background),
    "background-stronger": ink(8, background),

    "surface-base": ink(4),
    "surface-base-hover": hover,
    "surface-base-active": pressed,
    "surface-base-interactive-active": ink(10),
    "surface-inset-base": ink(4),
    "surface-inset-base-hover": hover,
    "surface-inset-strong": ink(8),
    "surface-inset-strong-hover": pressed,
    "surface-raised-base": raised,
    "surface-raised-base-hover": ink(6, raised),
    "surface-raised-base-active": ink(10, raised),
    "surface-raised-strong": raised,
    "surface-raised-strong-hover": ink(6, raised),
    "surface-raised-stronger": overlay,
    "surface-raised-stronger-hover": ink(6, overlay),
    "surface-raised-stronger-non-alpha": overlay,
    "surface-float-base": overlay,
    "surface-float-base-hover": ink(6, overlay),
    "surface-weak": ink(4),
    "surface-weaker": ink(2),
    "surface-strong": ink(10),
    "surface-brand-base": role("primary"),
    "surface-brand-hover": role("primary-active"),
    "surface-interactive-base": ink(10),
    "surface-interactive-hover": ink(14),
    "surface-interactive-weak": ink(6),
    "surface-interactive-weak-hover": ink(10),
    "surface-success-base": feedback("success", "surface"),
    "surface-success-weak": mix(feedback("success", "surface"), 60),
    "surface-success-strong": feedback("success", "fill"),
    "surface-warning-base": feedback("warning", "surface"),
    "surface-warning-weak": mix(feedback("warning", "surface"), 60),
    "surface-warning-strong": feedback("warning", "fill"),
    "surface-critical-base": feedback("danger", "surface"),
    "surface-critical-weak": mix(feedback("danger", "surface"), 60),
    "surface-critical-strong": feedback("danger", "fill"),
    "surface-info-base": feedback("info", "surface"),
    "surface-info-weak": mix(feedback("info", "surface"), 60),
    "surface-info-strong": feedback("info", "fill"),

    "input-base": background,
    "input-hover": ink(4, background),
    "input-active": ink(8, background),
    "input-selected": ink(8, background),
    "input-focus": background,
    "input-disabled": ink(4, background),

    "text-strong": foreground,
    "text-base": muted,
    "text-weak": muted,
    "text-weaker": disabled,
    "text-invert-base": background,
    "text-invert-weak": mix(background, 72),
    "text-invert-weaker": mix(background, 48),
    "text-invert-strong": background,
    "text-interactive-base": foreground,
    "text-on-brand-base": role("on-primary"),
    "text-on-brand-weak": mix(role("on-primary"), 72),
    "text-on-brand-weaker": mix(role("on-primary"), 52),
    "text-on-brand-strong": role("on-primary"),
    "text-on-interactive-base": background,
    "text-on-interactive-weak": mix(background, 72),
    "text-on-success-base": feedback("success", "foreground"),
    "text-on-success-weak": feedback("success", "foreground"),
    "text-on-success-strong": feedback("success", "foreground"),
    "text-on-warning-base": feedback("warning", "foreground"),
    "text-on-warning-weak": feedback("warning", "foreground"),
    "text-on-warning-strong": feedback("warning", "foreground"),
    "text-on-critical-base": feedback("danger", "foreground"),
    "text-on-critical-weak": feedback("danger", "foreground"),
    "text-on-critical-strong": feedback("danger", "foreground"),
    "text-on-info-base": feedback("info", "foreground"),
    "text-on-info-weak": feedback("info", "foreground"),
    "text-on-info-strong": feedback("info", "foreground"),
    "text-diff-add-base": feedback("success", "foreground"),
    "text-diff-add-strong": feedback("success", "foreground"),
    "text-diff-delete-base": feedback("danger", "foreground"),
    "text-diff-delete-strong": feedback("danger", "foreground"),

    "button-primary-base": role("primary"),
    "button-secondary-base": ink(6),
    "button-secondary-hover": ink(10),
    "button-ghost-hover": hover,
    "button-ghost-hover2": pressed,

    "border-base": role("elevation-base-border"),
    "border-hover": role("control-edge"),
    "border-active": foreground,
    "border-selected": foreground,
    "border-disabled": role("muted"),
    "border-focus": role("focus"),
    "border-color": role("elevation-base-border"),
    "border-weak-base": role("muted"),
    "border-weak-hover": role("elevation-base-border"),
    "border-weak-active": role("control-edge"),
    "border-weak-selected": foreground,
    "border-weak-disabled": ink(4),
    "border-weak-focus": role("focus"),
    "border-weaker-base": ink(5),
    "border-weaker-hover": role("muted"),
    "border-weaker-active": role("elevation-base-border"),
    "border-weaker-selected": foreground,
    "border-weaker-disabled": ink(3),
    "border-weaker-focus": role("focus"),
    "border-strong-base": role("control-edge"),
    "border-strong-hover": foreground,
    "border-strong-active": foreground,
    "border-strong-selected": foreground,
    "border-strong-disabled": role("muted"),
    "border-strong-focus": role("focus"),
    "border-interactive-base": foreground,
    "border-interactive-hover": foreground,
    "border-interactive-active": foreground,
    "border-interactive-selected": foreground,
    "border-interactive-disabled": role("muted"),
    "border-interactive-focus": role("focus"),
    "border-success-base": feedback("success", "border"),
    "border-success-hover": feedback("success", "foreground"),
    "border-success-selected": feedback("success", "foreground"),
    "border-warning-base": feedback("warning", "border"),
    "border-warning-hover": feedback("warning", "foreground"),
    "border-warning-selected": feedback("warning", "foreground"),
    "border-critical-base": feedback("danger", "border"),
    "border-critical-hover": feedback("danger", "foreground"),
    "border-critical-selected": feedback("danger", "foreground"),
    "border-info-base": feedback("info", "border"),
    "border-info-hover": feedback("info", "foreground"),
    "border-info-selected": feedback("info", "foreground"),

    "icon-base": muted,
    "icon-hover": foreground,
    "icon-active": foreground,
    "icon-selected": foreground,
    "icon-disabled": disabled,
    "icon-focus": role("focus"),
    "icon-invert-base": background,
    "icon-weak-base": mix(muted, 72, background),
    "icon-weak-hover": muted,
    "icon-weak-active": foreground,
    "icon-weak-selected": foreground,
    "icon-weak-disabled": disabled,
    "icon-weak-focus": role("focus"),
    "icon-strong-base": foreground,
    "icon-strong-hover": foreground,
    "icon-strong-active": foreground,
    "icon-strong-selected": foreground,
    "icon-strong-disabled": disabled,
    "icon-strong-focus": role("focus"),
    "icon-brand-base": role("primary"),
    "icon-interactive-base": foreground,
    "icon-success-base": feedback("success", "foreground"),
    "icon-success-hover": feedback("success", "foreground"),
    "icon-success-active": feedback("success", "foreground"),
    "icon-warning-base": feedback("warning", "foreground"),
    "icon-warning-hover": feedback("warning", "foreground"),
    "icon-warning-active": feedback("warning", "foreground"),
    "icon-critical-base": feedback("danger", "foreground"),
    "icon-critical-hover": feedback("danger", "foreground"),
    "icon-critical-active": feedback("danger", "foreground"),
    "icon-info-base": feedback("info", "foreground"),
    "icon-info-hover": feedback("info", "foreground"),
    "icon-info-active": feedback("info", "foreground"),
    "icon-on-brand-base": role("on-primary"),
    "icon-on-brand-hover": role("on-primary"),
    "icon-on-brand-selected": role("on-primary"),
    "icon-agent-build-base": agents.build,
    "icon-agent-plan-base": agents.plan,
    "icon-agent-docs-base": agents.writer,
    "icon-agent-ask-base": agents.explore,

    // Syntax and Markdown come from the design system's Color Layer, the contract it publishes for redcode.
    "syntax-comment": code.syntax.comment,
    "syntax-keyword": code.syntax.keyword,
    "syntax-string": code.syntax.string,
    "syntax-primitive": code.syntax.number,
    "syntax-property": code.syntax.variable,
    "syntax-type": code.syntax.type,
    "syntax-constant": code.syntax.constant,
    "syntax-operator": code.syntax.operator,
    "syntax-punctuation": code.syntax.punctuation,
    "syntax-variable": code.syntax.variable,
    "syntax-object": code.syntax.variable,
    "syntax-regexp": code.syntax.string,
    "syntax-critical": code.feedback.danger.foreground,
    "syntax-success": code.feedback.success.foreground,
    "syntax-warning": code.feedback.warning.foreground,
    "syntax-info": code.feedback.info.foreground,
    "syntax-diff-add": code.diff.addition.foreground,
    "syntax-diff-delete": code.diff.deletion.foreground,
    "syntax-diff-unknown": code.diff.modification.foreground,
    "markdown-heading": code.markdown.heading,
    "markdown-text": code.markdown.body,
    "markdown-link": code.markdown.link,
    "markdown-link-text": code.markdown.link,
    "markdown-code": code.markdown.code,
    "markdown-block-quote": code.markdown.quote,
    "markdown-emph": code.markdown.body,
    "markdown-strong": code.markdown.heading,
    "markdown-horizontal-rule": code.markdown.quoteBorder,
    "markdown-list-item": code.markdown.listMarker,
    "markdown-list-enumeration": code.markdown.listMarker,
    "markdown-image": code.markdown.link,
    "markdown-image-text": code.markdown.body,
    "markdown-code-block": code.markdown.code,
    "surface-diff-add-base": code.diff.addition.surface,
    "surface-diff-add-weak": mix(code.diff.addition.surface, 70),
    "surface-diff-add-weaker": mix(code.diff.addition.surface, 45),
    "surface-diff-add-strong": mix(code.diff.addition.border, 22, code.diff.addition.surface),
    "surface-diff-add-stronger": mix(code.diff.addition.border, 34, code.diff.addition.surface),
    "surface-diff-delete-base": code.diff.deletion.surface,
    "surface-diff-delete-weak": mix(code.diff.deletion.surface, 70),
    "surface-diff-delete-weaker": mix(code.diff.deletion.surface, 45),
    "surface-diff-delete-strong": mix(code.diff.deletion.border, 22, code.diff.deletion.surface),
    "surface-diff-delete-stronger": mix(code.diff.deletion.border, 34, code.diff.deletion.surface),
    "icon-diff-add-base": code.diff.addition.foreground,
    "icon-diff-add-hover": code.diff.addition.foreground,
    "icon-diff-add-active": code.diff.addition.foreground,
    "icon-diff-delete-base": code.diff.deletion.foreground,
    "icon-diff-delete-hover": code.diff.deletion.foreground,
    "icon-diff-modified-base": code.diff.modification.foreground,
  }
}

const variant = (dark: boolean): ThemeVariant => ({
  palette: dark ? SEEDS.dark : SEEDS.light,
  // Values are CSS expressions (var(), color-mix()), which the engine passes through untouched.
  overrides: legacy(dark) as ThemeVariant["overrides"],
  v2Overrides: semantics(dark),
})

export const applicationTheme: DesktopTheme = {
  name: "Redcode",
  id: APPLICATION_THEME_ID,
  light: variant(false),
  dark: variant(true),
}
