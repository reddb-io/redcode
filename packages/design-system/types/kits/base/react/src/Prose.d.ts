import { type ComponentPropsWithRef } from "react";
import { type ProseElement, type ProseMeasure } from "../../src/prose.variants";
interface ProseAppearance<Element extends ProseElement> {
    /** Reading width: prose, content or full. */
    measure?: ProseMeasure;
    /** Tint alternate table body rows. */
    striped?: boolean;
    /** Native document boundary: div, article or section. */
    as?: Element;
}
export type ProseProps<Element extends ProseElement = "div"> = ProseAppearance<Element> & Omit<ComponentPropsWithRef<Element>, keyof ProseAppearance<Element>>;
export declare function Prose<Element extends ProseElement = "div">({ measure, striped, as, className, ...rest }: ProseProps<Element>): import("react").DetailedReactHTMLElement<Omit<ProseProps<Element>, "className" | "as" | "measure" | "striped"> & {
    "data-prose": boolean;
    "data-prose-measure": ProseMeasure;
    className: string;
}, HTMLElement>;
export {};
