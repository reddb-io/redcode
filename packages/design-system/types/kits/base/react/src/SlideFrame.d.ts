import type { ComponentPropsWithRef, ReactNode } from "react";
import { type SlideSurface } from "../../src/slide-frame.variants";
export interface SlideFrameProps extends Omit<ComponentPropsWithRef<"div">, "className" | "role" | "children"> {
    /** The slide's accessible name, announced with the "slide" role description. */
    label: string;
    /** The slide's position in its deck, shown in the bottom margin when given. */
    number?: number;
    /** How many slides the deck has; shown after `number` when both are given. */
    total?: number;
    /** The ground the slide is set on: the page `background` (default) or the `raised` elevation. */
    surface?: SlideSurface;
    /** Extra classes merged onto the frame. */
    className?: string;
    /** The slide's content, laid out inside the safe title area of the canvas. */
    children?: ReactNode;
}
export declare function SlideFrame({ label, number, total, surface, className, children, ...rest }: SlideFrameProps): import("react").JSX.Element;
