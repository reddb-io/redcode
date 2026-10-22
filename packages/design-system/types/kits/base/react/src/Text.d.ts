import { type ComponentPropsWithRef, type ReactNode } from "react";
import { type TextRole, type TextInk, type TextElement } from "../../src/text.variants";
interface TextAppearance<Element extends TextElement> {
    /** Copy rendered inside the element, required by the common contract. */
    children: ReactNode;
    /** Theme reading role. */
    role?: TextRole;
    /** Ink emphasis; captions default to muted. */
    ink?: TextInk;
    /** Native element: p, span, div or small. */
    as?: Element;
}
export type TextProps<Element extends TextElement = "p"> = TextAppearance<Element> & Omit<ComponentPropsWithRef<Element>, keyof TextAppearance<Element>>;
export declare function Text<Element extends TextElement = "p">({ role, ink, as, className, ...rest }: TextProps<Element>): import("react").DetailedReactHTMLElement<Omit<TextProps<Element>, "ink" | "className" | "role" | "as"> & {
    "data-text": boolean;
    "data-type-role": TextRole;
    className: string;
}, HTMLElement>;
export {};
