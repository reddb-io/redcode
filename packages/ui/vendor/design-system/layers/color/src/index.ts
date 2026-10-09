import darkValue from "./dark.json" with { type: "json" };
import lightValue from "./light.json" with { type: "json" };

/** A message in a meaning: its tinted ground, its copy, and its text-grade edge. */
export interface StateColors {
  surface: string;
  foreground: string;
  border: string;
}

/**
 * A Feedback Role adds the material a filled control acting in it is drawn
 * with (a danger Button): `fill` under an `onFill` label. The text-grade
 * `foreground` is copy and never a fill (ADR 0023).
 */
export interface FeedbackColors extends StateColors {
  fill: string;
  /** The fill hovered, pressed or holding a popup open: opaque, `onFill` keeps AA (wave 6A). */
  fillActive: string;
  onFill: string;
}

export interface ColorScheme {
  surface: {
    canvas: string;
    base: string;
    raised: string;
    overlay: string;
    sunken: string;
    selected: string;
    /** A quiet fill, track or divider band: translucent ink composited over the canvas (ADR 0019). */
    muted: string;
    /** The fill `text.inverse` sits on (a solid Badge or Pill). */
    inverse: string;
  };
  text: {
    primary: string;
    muted: string;
    subtle: string;
    inverse: string;
    /** Ink, not accent: draw it with a persistent underline (ADR 0023). */
    link: string;
    selection: string;
    /** Accent copy (an eyebrow, a spinner): its own material, never the danger copy (ADR 0023). */
    accent: string;
  };
  border: {
    subtle: string;
    default: string;
    /** The boundary that identifies a control: at least 3:1 on every surface. */
    strong: string;
    /** Ink (ADR 0023): red on a control means the primary action, a checked state or an error. */
    focus: string;
  };
  action: {
    primary: string;
    hover: string;
    active: string;
    primaryForeground: string;
    secondary: string;
    secondaryHover: string;
    secondaryActive: string;
    secondaryForeground: string;
  };
  feedback: {
    info: FeedbackColors;
    success: FeedbackColors;
    warning: FeedbackColors;
    danger: FeedbackColors;
  };
  diff: {
    addition: StateColors;
    deletion: StateColors;
    modification: StateColors;
  };
  markdown: {
    heading: string;
    body: string;
    link: string;
    code: string;
    quote: string;
    quoteBorder: string;
    listMarker: string;
  };
  syntax: {
    comment: string;
    keyword: string;
    string: string;
    number: string;
    function: string;
    variable: string;
    type: string;
    operator: string;
    punctuation: string;
    constant: string;
  };
  /** The categorical sequence (chart series, node roles): non-text marks, 3:1 on the canvas. */
  series: {
    "1": string;
    "2": string;
    "3": string;
    "4": string;
    "5": string;
    "6": string;
  };
}

export type ColorSchemeName = "dark" | "light";

export const dark: ColorScheme = darkValue;
export const light: ColorScheme = lightValue;
export const colorSchemes: Readonly<Record<ColorSchemeName, ColorScheme>> = { dark, light };
