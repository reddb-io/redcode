import { type ComponentPropsWithRef, type ReactNode } from "react";
import { type EyebrowElement } from "../../src/eyebrow.variants";
interface EyebrowAppearance<Element extends EyebrowElement> {
    /** Native non-heading element: p, span or div. */
    as?: Element;
    /** Short phrase naming the section that follows. */
    children: ReactNode;
}
export type EyebrowProps<Element extends EyebrowElement = "p"> = EyebrowAppearance<Element> & Omit<ComponentPropsWithRef<Element>, keyof EyebrowAppearance<Element>>;
export declare function Eyebrow<Element extends EyebrowElement = "p">({ as, className, ...rest }: EyebrowProps<Element>): import("react").DetailedReactHTMLElement<Omit<EyebrowProps<Element>, "className" | "as"> & {
    "data-eyebrow": boolean;
    "data-type-role": string;
    className: string;
}, HTMLSpanElement>;
export {};
