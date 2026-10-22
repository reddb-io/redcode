import type { ComponentPropsWithRef } from "react";
import type { SlideSurface } from "../../src/slide-frame.variants";
export interface QuoteSlideProps extends Omit<ComponentPropsWithRef<"div">, "className" | "role" | "children"> {
    /** The quotation, without quotation marks: the slide sets them. Set in the title role. */
    quote: string;
    /** Who said it. */
    attribution: string;
    /** Where or in what capacity they said it, after the attribution. */
    source?: string;
    /** The slide's accessible name. Defaults to "Quote from" and the attribution. */
    label?: string;
    /** The slide's position in its deck, shown in the bottom margin when given. */
    number?: number;
    /** How many slides the deck has; shown after `number` when both are given. */
    total?: number;
    /** The ground the slide is set on: the page `background` (default) or the `raised` elevation. */
    surface?: SlideSurface;
    /** Extra classes merged onto the frame. */
    className?: string;
}
export declare function QuoteSlide({ quote, attribution, source, label, number, total, surface, className, ...rest }: QuoteSlideProps): import("react").JSX.Element;
