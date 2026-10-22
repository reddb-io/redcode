import type { ComponentPropsWithRef, ReactNode } from "react";
import { type DescriptionListGap } from "../../src/description-list.appearance";
import type { DescriptionListEntry } from "../../src/core/description-list";
export type DescriptionListItem = DescriptionListEntry<ReactNode>;
export interface DescriptionListProps extends ComponentPropsWithRef<"dl"> {
    /** Ordered term/detail pairs, rendered with native dt and dd semantics. */
    items?: readonly DescriptionListItem[];
    /** Density-owned space within and between entries. */
    gap?: DescriptionListGap;
}
export declare function DescriptionList({ items, gap, className, ...rest }: DescriptionListProps): import("react").JSX.Element;
