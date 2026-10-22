import { type ComponentPropsWithRef } from "react";
import { type KbdSize } from "../../src/kbd.variants";
export interface KbdProps extends ComponentPropsWithRef<"kbd"> {
    /** Ordered keys in a chord; children replace them with one custom key cap. */
    keys?: readonly string[];
    /** Decorative separator, hidden from assistive technology. */
    separator?: string;
    /** Key cap size; follows surrounding type rather than Density. */
    size?: KbdSize;
}
export declare function Kbd({ keys, separator, size, className, children, ...rest }: KbdProps): import("react").JSX.Element;
