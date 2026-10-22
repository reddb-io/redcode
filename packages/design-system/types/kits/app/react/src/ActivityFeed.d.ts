import type { ComponentPropsWithRef } from "react";
import type { ActivityFeedContract } from "../../src/core/contracts/activityfeed";
export interface ActivityFeedProps extends ActivityFeedContract, Omit<ComponentPropsWithRef<"ol">, keyof ActivityFeedContract | "children"> {
    /** Additional list classes. */
    className?: string;
}
export declare function ActivityFeed({ items, label, className, ...rest }: ActivityFeedProps): import("react").JSX.Element;
