import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { IncentiveContract } from "../../src/core/contracts/incentive";
export interface IncentiveProps extends IncentiveContract, Omit<ComponentPropsWithRef<"div">, keyof IncentiveContract | "children"> {
    /** Decorative artwork; the title conveys its meaning. */
    icon: ReactNode;
    /** Canonical links and controls. */
    actions?: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function Incentive({ title, description, level, icon, actions, className, ...rest }: IncentiveProps): import("react").JSX.Element;
