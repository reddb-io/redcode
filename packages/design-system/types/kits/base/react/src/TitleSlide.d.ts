import type { ComponentPropsWithRef } from "react";
import type { SlideSurface } from "../../src/slide-frame.variants";
import type { HeadingLevel } from "../../src/heading.variants";
export interface TitleSlideProps extends Omit<ComponentPropsWithRef<"div">, "className" | "role" | "title" | "children"> {
    /** The deck's title, set in the display role. */
    title: string;
    /** A micro-label above the title, such as the event or the series. */
    eyebrow?: string;
    /** One line under the title, in the heading role and secondary ink. */
    subtitle?: string;
    /** Who presents and when, at the foot of the slide. */
    presenter?: string;
    /** The title's outline level. Defaults to 2, so a page heading can sit above the deck. */
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
export declare function TitleSlide({ title, eyebrow, subtitle, presenter, level, label, number, total, surface, className, ...rest }: TitleSlideProps): import("react").JSX.Element;
