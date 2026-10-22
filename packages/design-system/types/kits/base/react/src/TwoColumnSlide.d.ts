import type { ComponentPropsWithRef, ReactNode } from "react";
import type { SlideSurface } from "../../src/slide-frame.variants";
import type { HeadingLevel } from "../../src/heading.variants";
export interface TwoColumnSlideProps extends Omit<ComponentPropsWithRef<"div">, "className" | "role" | "title" | "children"> {
    /** The slide's title, set in the title role. */
    title: string;
    /** A micro-label above the title. */
    eyebrow?: string;
    /** The first column, in reading order (left in a left-to-right script). */
    start: ReactNode;
    /** The second column, in reading order (right in a left-to-right script). */
    end: ReactNode;
    /** The title's outline level. Defaults to 2. */
    level?: HeadingLevel;
    /** The slide's accessible name. Defaults to `title`. */
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
export declare function TwoColumnSlide({ title, eyebrow, start, end, level, label, number, total, surface, className, ...rest }: TwoColumnSlideProps): import("react").JSX.Element;
