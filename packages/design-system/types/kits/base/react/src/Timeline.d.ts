import type { ComponentPropsWithRef } from "react";
import type { TimelineItem } from "../../src/core/timeline";
export type { TimelineItem } from "../../src/core/timeline";
export interface TimelineProps extends Omit<ComponentPropsWithRef<"ol">, "children"> {
    /**
     * The entries in display order; each has a `title`, a machine-readable `datetime`, visible
     * `time` text, and optionally a `description` and an `href` that makes the title a link.
     */
    items: readonly TimelineItem[];
    /** Accessible name of the list; defaults to `Timeline`. */
    label?: string;
    /** Extra classes, merged over the root slot's own. */
    className?: string;
}
export declare function Timeline({ items, label, className, ...rest }: TimelineProps): import("react").JSX.Element;
