import horizontalColor from "./marks/reddb-horizontal-color.svg.js";
import horizontalInverse from "./marks/reddb-horizontal-inverse.svg.js";
import iconColor from "./marks/reddb-icon-color.svg.js";
import stackedColor from "./marks/reddb-stacked-color.svg.js";
import stackedInverse from "./marks/reddb-stacked-inverse.svg.js";
import symbolBlack from "./marks/reddb-symbol-black.svg.js";
import symbolColor from "./marks/reddb-symbol-color.svg.js";
import symbolKnockout from "./marks/reddb-symbol-knockout.svg.js";
import symbolWhite from "./marks/reddb-symbol-white.svg.js";
import wordmarkBlack from "./marks/reddb-wordmark-black.svg.js";
import wordmarkWhite from "./marks/reddb-wordmark-white.svg.js";
const BRAND_RELEASE = "2026.10.1";
const LOGO_LAYOUTS = ["horizontal", "stacked", "icon", "symbol", "wordmark"];
const LOGO_SURFACES = ["light", "dark"];
const MARKS = {
  horizontal: {
    light: {
      file: "reddb-horizontal-color.svg",
      src: horizontalColor,
      width: 397.712,
      height: 100,
      symbolHeight: 100
    },
    dark: {
      file: "reddb-horizontal-inverse.svg",
      src: horizontalInverse,
      width: 397.712,
      height: 100,
      symbolHeight: 100
    }
  },
  stacked: {
    light: {
      file: "reddb-stacked-color.svg",
      src: stackedColor,
      width: 140,
      height: 154.423,
      symbolHeight: 100
    },
    dark: {
      file: "reddb-stacked-inverse.svg",
      src: stackedInverse,
      width: 140,
      height: 154.423,
      symbolHeight: 100
    }
  },
  icon: {
    light: {
      file: "reddb-icon-color.svg",
      src: iconColor,
      width: 100,
      height: 100,
      symbolHeight: 100
    }
    // No `dark`: the pinned release ships no icon inverse. The chatbot avatar
    // on a dark surface is blocked here until the Brand ships one (ADR 0004).
  },
  symbol: {
    // The Brand names these two single-colour variants by their intended
    // grounds: black for light, white for dark. `color` is the primary
    // treatment and `knockout` describes transparency, not a third kind of
    // surface, so neither distorts the `on` vocabulary.
    light: {
      file: "reddb-symbol-black.svg",
      src: symbolBlack,
      width: 100,
      height: 100,
      symbolHeight: 100
    },
    dark: {
      file: "reddb-symbol-white.svg",
      src: symbolWhite,
      width: 100,
      height: 100,
      symbolHeight: 100
    }
  },
  wordmark: {
    light: {
      file: "reddb-wordmark-black.svg",
      src: wordmarkBlack,
      width: 308.3,
      height: 71.4,
      symbolHeight: 71.4
    },
    dark: {
      file: "reddb-wordmark-white.svg",
      src: wordmarkWhite,
      width: 308.3,
      height: 71.4,
      symbolHeight: 71.4
    }
  }
};
const MARK_CATALOGUE = [
  ...LOGO_LAYOUTS.flatMap(
    (layout) => LOGO_SURFACES.map((on) => MARKS[layout][on]).filter(
      (mark) => mark !== void 0
    )
  ),
  {
    file: "reddb-symbol-color.svg",
    src: symbolColor,
    width: 100,
    height: 100,
    symbolHeight: 100
  },
  {
    file: "reddb-symbol-knockout.svg",
    src: symbolKnockout,
    width: 100,
    height: 100,
    symbolHeight: 100
  }
];
class MarkNotShippedError extends Error {
  /** The layout that was asked for. */
  layout;
  /** The surface it was asked for. */
  on;
  /** The Assets release that ships no such Mark. */
  release;
  constructor(layout, on, release = BRAND_RELEASE) {
    const alternatives = LOGO_LAYOUTS.filter((other) => MARKS[other][on] !== void 0);
    super(
      `Logo: the pinned Brand Assets release ${release} ships no ${layout} Mark for a ${on} surface.
The Logo refuses rather than falling back to the other surface's Mark or recoloring one: the Brand owns the drawing and the DS owns only its placement (ADR 0004), so a variant that does not exist upstream is a Brand proposal, not a local file.
Until the Brand ships it, place the ${layout} Mark on the surface it has (on="${on === "dark" ? "light" : "dark"}"), or use ${alternatives.map((other) => `layout="${other}"`).join(" or ")} on a ${on} surface.`
    );
    this.name = "MarkNotShippedError";
    this.layout = layout;
    this.on = on;
    this.release = release;
  }
}
function selectMark(layout, on) {
  const mark = MARKS[layout][on];
  if (mark === void 0) throw new MarkNotShippedError(layout, on);
  return mark;
}
function shipsMark(layout, on) {
  return MARKS[layout][on] !== void 0;
}
export {
  BRAND_RELEASE,
  LOGO_LAYOUTS,
  LOGO_SURFACES,
  MARKS,
  MARK_CATALOGUE,
  MarkNotShippedError,
  selectMark,
  shipsMark
};
