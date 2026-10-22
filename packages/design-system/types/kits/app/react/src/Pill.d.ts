import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { PillContract } from "../../src/core/contracts/pill";
export interface PillProps extends PillContract, Omit<ComponentPropsWithRef<"span">, keyof PillContract | "children"> {
    /** Remove affordance; omitted when the caller provides no removal action. */
    onDismiss?: () => void;
    /** Label content before the dismiss affordance. */
    children?: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function Pill({ tone, variant, size, onDismiss, dismissLabel, children, className, ...rest }: PillProps): import("react").JSX.Element;
