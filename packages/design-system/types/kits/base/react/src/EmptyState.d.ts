import type { ComponentPropsWithRef, ReactNode } from "react";
import { type EmptyStateSize } from "../../src/empty-state.variants";
export interface EmptyStateProps extends Omit<ComponentPropsWithRef<"div">, "title" | "children"> {
    /** What is empty, in a few words. */
    title: string;
    /** Why it is empty, or what would fill it. */
    description?: string;
    /** A literal command, path, or key that would fill it. */
    hint?: string;
    /** Defaults to `md`. */
    size?: EmptyStateSize;
    /** Draw the dashed outline around the region. Defaults to true. */
    bordered?: boolean;
    /** An icon or illustration, rendered decoratively above the title. */
    media?: ReactNode;
    /** Caller-owned controls rendered after the explanation. */
    actions?: ReactNode;
    /** Extra classes merged over the root slot. */
    className?: string;
}
export declare function EmptyState({ title, description, hint, size, bordered, media, actions, className, ...rest }: EmptyStateProps): import("react").JSX.Element;
