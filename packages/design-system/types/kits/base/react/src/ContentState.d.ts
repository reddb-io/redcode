import type { ComponentPropsWithRef, ReactNode } from "react";
import type { ContentStateContract } from "../../src/core/contracts/contentstate";
export interface ContentStateProps extends ContentStateContract, Omit<ComponentPropsWithRef<"div">, "children" | "role" | "aria-busy" | "aria-label"> {
    /** Ready content. The application owns its components, data and interactions. */
    children: ReactNode;
    /** Optional loading composition instead of the default Skeleton. Keep its children decorative. */
    loading?: ReactNode;
    /** Optional empty composition instead of the default EmptyState. */
    empty?: ReactNode;
    /** Optional error composition receiving the message; it owns error and retry announcements. */
    failure?: (message: string) => ReactNode;
    /** Called when the person retries after an error; adds a retry action to the default error (ADR 0056). */
    onRetry?: () => void;
}
export declare function ContentState({ state, label, height, shape, rows, columns, animated, emptyTitle, emptyDescription, errorMessage, announcement, retryLabel, onRetry, children, loading, empty, failure, className, style, ...rest }: ContentStateProps): import("react").JSX.Element;
