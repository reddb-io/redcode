import type { ComponentPropsWithRef, ReactNode } from "react";
import { type ScrollAreaOrientation } from "../../src/scroll-area.variants";
export interface ScrollAreaProps extends Omit<ComponentPropsWithRef<"div">, "aria-label" | "children" | "role" | "tabIndex"> {
    /** Accessible region name, required because this is a keyboard stop. */
    label: string;
    /** Which native overflow directions this boundary contains. */
    orientation?: ScrollAreaOrientation;
    /** Surface treatment: `outline` keeps the standalone frame and Density inset; `plain` embeds native scrolling in an existing panel. Defaults to `outline`. */
    variant?: "outline" | "plain";
    /** Extra classes, including the consumer-owned size constraint. */
    className?: string;
    /** Content that scrolls inside the region. */
    children?: ReactNode;
}
export declare function ScrollArea({ label, orientation, variant, className, children, ...rest }: ScrollAreaProps): import("react").JSX.Element;
