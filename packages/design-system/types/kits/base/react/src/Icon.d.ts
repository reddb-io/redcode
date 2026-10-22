import { type ComponentPropsWithRef, type ForwardRefExoticComponent, type RefAttributes, type SVGAttributes } from "react";
import { type IconColor, type IconSize, type DeprecatedIconColor } from "../../src/core/icon";
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
    /** Consumer-supplied Lucide glyph, or the built-in navigation menu without the optional icon package. */
    icon: IconGlyph | "menu";
    /** Density-responsive DS size. */
    size?: IconSize;
    /** Semantic Theme ink role. The deprecated muted alias draws in ink-muted. */
    color?: IconColor | DeprecatedIconColor;
}
export declare function Icon({ icon: Glyph, size, color, className, ...rest }: IconProps): import("react").JSX.Element;
