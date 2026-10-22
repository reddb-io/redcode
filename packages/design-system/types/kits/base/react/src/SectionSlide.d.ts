import type { ComponentPropsWithRef } from "react";
import type { SlideSurface } from "../../src/slide-frame.variants";
import type { HeadingLevel } from "../../src/heading.variants";
export interface SectionSlideProps extends Omit<ComponentPropsWithRef<"div">, "className" | "role" | "title" | "children"> {
    /** The section's title, set in the display role. */
    title: string;
    /** A micro-label above the title, such as "Part 2". */
    eyebrow?: string;
    /** One line on what the section covers, in the heading role and secondary ink. */
    summary?: string;
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
export declare function SectionSlide({ title, eyebrow, summary, level, label, number, total, surface, className, ...rest }: SectionSlideProps): import("react").JSX.Element;
