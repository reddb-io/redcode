<!-- The only sanctioned seam between a Kit component and a lucide glyph. -->
<script lang="ts" module>
  import type { LucideProps } from "@lucide/svelte";
  import type { Component } from "svelte";

  /*! @license Built-in menu geometry: Copyright (c) 2026 Lucide Icons and Contributors.
   * Permission to use, copy, modify, and/or distribute this software for any
   * purpose with or without fee is hereby granted, provided that the above
   * copyright notice and this permission notice appear in all copies.
   * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
   * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
   * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
   * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
   * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
   * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
   * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
   */

  export const ICON_SIZES = ["sm", "md", "lg"] as const;
  export type IconSize = (typeof ICON_SIZES)[number];

  export const ICON_COLORS = [
    "current",
    "foreground",
    "ink-muted",
    "primary",
    "on-primary",
    "feedback-danger-foreground",
    "feedback-success-foreground",
    "feedback-warning-foreground",
    "feedback-info-foreground",
  ] as const;
  export type IconColor = (typeof ICON_COLORS)[number];

  // Colours the Icon still accepts for one release, and the role each draws in
  // instead. `muted` is a surface role — ink at 8% since ADR 0019, 1.19:1 on
  // white — so a glyph drawn in it was all but invisible. It now draws in
  // `ink-muted` and warns in development; the next release removes it.
  const DEPRECATED_ICON_COLORS = { muted: "ink-muted" } as const satisfies Record<
    string,
    IconColor
  >;
  /** @deprecated Draws in `ink-muted`; pass `color="ink-muted"`. Removed next release. */
  type DeprecatedIconColor = keyof typeof DEPRECATED_ICON_COLORS;
  const warnedDeprecatedColors = new Set<DeprecatedIconColor>();

  function isDeprecatedColor(color: string): color is DeprecatedIconColor {
    return Object.hasOwn(DEPRECATED_ICON_COLORS, color);
  }

  export type IconGlyphProps = LucideProps;
  export type IconGlyph = Component<IconGlyphProps>;
</script>

<script lang="ts">
  import type { SVGAttributes } from "svelte/elements";

  interface Props
    extends Omit<
      SVGAttributes<SVGSVGElement>,
      "color" | "height" | "stroke" | "stroke-width" | "width"
    > {
    /** A consumer-supplied Lucide glyph, or the built-in menu glyph used by navigation without loading the optional icon package. */
    icon: IconGlyph | "menu";
    /** Density-responsive DS size. */
    size?: IconSize;
    /**
     * Semantic Theme color; raw color values are deliberately not accepted.
     * `current` inherits the surrounding ink, so a glyph follows its control's
     * hover and selected states or a caller's token-backed text class.
     * `muted` is a deprecated alias that draws in `ink-muted` for one release.
     */
    color?: IconColor | DeprecatedIconColor;
  }

  let {
    icon: Glyph,
    size = "md",
    color = "foreground",
    class: className,
    ...rest
  }: Props = $props();

  const dimension = $derived(`var(--reddb-spatial-icon-size-${size})`);
  const role = $derived<IconColor>(
    isDeprecatedColor(color) ? DEPRECATED_ICON_COLORS[color] : color,
  );
  const resolvedColor = $derived(
    role === "current" ? "currentColor" : `var(--reddb-color-${role})`,
  );
  // Keep the public seam exact (`IconGlyph` is Lucide's own props) while
  // preventing Svelte's template checker from expanding the complete SVG
  // attribute union at this dynamic component boundary.
  const RenderGlyph = $derived(Glyph as Component<Record<string, unknown>>);

  // Warn once per session, and only in a development build (the consumer's
  // bundler sets `import.meta.env.DEV`); production keeps the alias silently.
  $effect(() => {
    if (!import.meta.env?.DEV || !isDeprecatedColor(color)) return;
    if (warnedDeprecatedColors.has(color)) return;
    warnedDeprecatedColors.add(color);
    console.warn(
      `[reddb Icon] color="${color}" is deprecated: it draws in "${DEPRECATED_ICON_COLORS[color]}" ` +
        `and is removed in the next release. Pass color="${DEPRECATED_ICON_COLORS[color]}".`,
    );
  });
</script>

{#if Glyph === "menu"}
  <!-- Geometry: Lucide menu, @lucide/svelte 1.52.0 (ISC). -->
  <svg {...rest} data-icon width={dimension} height={dimension} viewBox="0 0 24 24" fill="none" stroke={resolvedColor} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={className}>
    <path d="M4 5h16" /><path d="M4 12h16" /><path d="M4 19h16" />
  </svg>
{:else}
  <RenderGlyph {...rest} data-icon size={dimension} color={resolvedColor} strokeWidth={2} class={className} />
{/if}
