import type { ComponentPropsWithRef } from "react";
import type { NodeBadgeContract } from "../../src/core/contracts/nodebadge";
export interface NodeBadgeProps extends NodeBadgeContract, Omit<ComponentPropsWithRef<"span">, keyof NodeBadgeContract | "children"> {
    /** Additional root classes. */
    className?: string;
}
export declare function NodeBadge({ name, status, showStatus, className, ...rest }: NodeBadgeProps): import("react").JSX.Element;
