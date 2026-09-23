export type Target = "web" | "app" | "presentation"
export type Platform = "ios" | "android"

export interface Viewport {
  readonly width: number
  readonly height: number
  /** The phone an app viewport stands for; absent for web and presentation viewports. */
  readonly device?: Platform
}

/**
 * The viewports a design is reviewed and audited at, from its target: web uses the configured
 * breakpoints (sorted, without repeats; 390, 768 and 1440 by default) at the audit's historical
 * 900px height, an app one phone per platform (both when none is chosen: a 393×852 iPhone and a
 * 412×915 Android phone, in CSS pixels) and a presentation one 1920×1080 slide. A missing target is
 * web: documents saved before targets existed carry none.
 *
 * It lives here rather than in core so the renderer and the review page share one definition, and it
 * is self-contained because review hosts serialize it into the standalone page with `toString()`.
 */
export function viewports(
  target: Target | undefined,
  platform: Platform | undefined,
  config: { readonly breakpoints?: readonly number[] } = {},
): Viewport[] {
  const phones: Record<Platform, Viewport> = {
    ios: { width: 393, height: 852, device: "ios" },
    android: { width: 412, height: 915, device: "android" },
  }
  if (target === "presentation") return [{ width: 1920, height: 1080 }]
  if (target === "app") return platform ? [phones[platform]] : [phones.ios, phones.android]
  const widths = config.breakpoints?.length ? config.breakpoints : [390, 768, 1440]
  return [...new Set(widths)].sort((a, b) => a - b).map((width) => ({ width, height: 900 }))
}
