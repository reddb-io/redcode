import type { ComponentPropsWithRef, ReactNode } from "react";
export interface DeckProps extends Omit<ComponentPropsWithRef<"section">, "className" | "children"> {
    /** The deck's accessible name; it makes the deck a named region of the page. */
    label: string;
    /** Extra classes merged onto the deck. */
    className?: string;
    /** The slides, each a SlideFrame or a slide layout. */
    children?: ReactNode;
}
export declare function Deck({ label, className, children, ...rest }: DeckProps): import("react").JSX.Element;
