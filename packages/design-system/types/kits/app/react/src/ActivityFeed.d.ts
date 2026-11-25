import type { ComponentPropsWithRef } from "react";
import type { ActivityFeedContract } from "../../src/core/contracts/activityfeed";
export interface ActivityFeedProps extends ActivityFeedContract, Omit<ComponentPropsWithRef<"ol">, keyof ActivityFeedContract | "children"> {
    /** Called when the person retries after a failed load. */
    onRetry?: () => void;
    /** Additional list classes (or classes on the loading, empty or error state that replaces the list). */
    className?: string;
}
export declare function ActivityFeed({ items, label, state, errorMessage, retryLabel, loadingRows, onRetry, className, "aria-busy": ariaBusy, ...rest }: ActivityFeedProps): import("react").JSX.Element;
