# Color Layer

The Color Layer is the portable, consumer-neutral color contract for developer surfaces. It is the Theme Layer, resolved: every role it ships is read off the composed Theme artifacts (Tokens, the Theme materials, both Color Schemes) for the `application` Theme under the light and dark Color Schemes, and written as lowercase six-digit hex. Its groups are surfaces, text, borders, actions, feedback (including info), diff, Markdown, syntax and the categorical series.

Consumers can route `color` with an empty `kits` array. The Sync lands typed source plus `dark.json` and `light.json`; no Svelte, CSS custom property, Tailwind utility, consumer preset, or terminal-program palette is involved.

```ts
import { colorSchemes, type ColorScheme } from "@reddb-io/design-system/color";

const dark: ColorScheme = colorSchemes.dark;
```

## The grammar it mirrors

- **Focus is ink** (`border.focus`, ADR 0023). Red on a control means the primary action, a checked state or an error.
- **Links are ink with an underline** (`text.link`, `markdown.link`). The colour alone does not mark a link, so draw the underline.
- **Accent copy is its own role** (`text.accent`), never the danger copy. It is ink unless a white-label override moves it.
- **Danger is deeper than the accent.** A filled destructive control uses `feedback.danger.fill` under `feedback.danger.onFill`, never `action.primary`. Every Feedback Role carries a `fill`/`onFill` pair. Its `foreground` is copy, glyphs and text-grade edges only.
- **Muted is pre-composited.** In the Theme `muted` is ink at 8% (ADR 0019). Here `surface.muted` and `border.subtle` are that ink composited over `surface.canvas`. The selected state (`surface.selected`, the Kits' `bg-foreground/10`) is composited the same way. On another ground they are slightly off; re-composite if you need exact values.
- **`text.subtle`** is a quiet third tier for in-flow surfaces (gutters, placeholders). On `surface.overlay`, use `text.muted`.
- **`series` 1–6** are non-text marks: chart series and node roles, at 3:1 on the canvas. They are not text colours.
- **Diff lines** use the Feedback Roles, as the Data Kit's Diff does: addition is success, deletion is danger, modification is warning.

## Where the values come from

`tools/color.ts` declares one source per key. A Theme role (`--reddb-color-<role>`) is resolved through the theme package's cascade. A key that no Theme role names reads a Brand token directly and records why:

- `text.subtle`: the Kits draw two text tiers only.
- `action.hover`, `action.active`: the Kits draw the accent's hover as an opacity over the ground.
- `action.secondary*`: the Kits' secondary action is transparent with a control edge.
- `syntax.*` except `keyword` and `operator`: no Theme role names a syntax token. The hues are Brand text-grade stops, never the accent or the danger red.

`pnpm --filter @reddb-io/color build` regenerates both JSON files. The test suite fails when a Theme-backed value differs from what the cascade resolves, and it checks every text pair the Layer implies at WCAG AA.

The raw POSIX terminal palette remains a separate Tokens Layer artifact at `@reddb-io/tokens/palette.sh` for shell integrations that need primitives rather than UX meanings.
