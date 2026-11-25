import { type ComponentPropsWithRef, type ForwardRefExoticComponent, type RefAttributes, type SVGAttributes } from "react";
import { type IconColor, type IconSize } from "../../src/core/icon";
export { ICON_SIZES, ICON_COLORS, type IconSize, type IconColor } from "../../src/core/icon";
/** Structural Lucide seam, so unused optional peers are not needed by a consumer type-check. */
export interface IconGlyphProps extends SVGAttributes<SVGSVGElement>, RefAttributes<SVGSVGElement> {
    /** Requested glyph size, owned by the DS wrapper at render time. */
    size?: string | number;
    /** Lucide's retained native stroke option. */
    absoluteStrokeWidth?: boolean;
    /** Keep stroke width independent of SVG scaling. */
    nonScalingStroke?: boolean;
}
export type IconGlyph = ForwardRefExoticComponent<IconGlyphProps>;
export interface IconProps extends Omit<ComponentPropsWithRef<"svg">, "color" | "height" | "stroke" | "strokeWidth" | "width"> {
    /** Consumer-supplied Lucide glyph, or a built-in glyph without the optional icon package. */
    icon: IconGlyph | "menu" | "chevron-down" | "x" | "maximize" | "restore" | "mic";
    /** Density-responsive DS size for a glyph alone in a control, or `text` to follow the label it sits beside (ADR 0054). */
    size?: IconSize;
    /** Semantic Theme ink role; `current` (the default, ADR 0054) follows the surrounding ink. */
    color?: IconColor;
}
export declare function Icon({ icon: Glyph, size, color, className, ...rest }: IconProps): import("react").JSX.Element;
