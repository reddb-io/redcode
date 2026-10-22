import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { ReviewContract } from "../../src/core/contracts/review";
export interface ReviewProps extends ReviewContract, Omit<ComponentPropsWithRef<"article">, keyof ReviewContract | "children"> {
    /** Caller-authored review body. */
    children: ReactNode;
    /** Actions after the body. */
    actions?: ReactNode;
    /** Additional article classes. */
    className?: string;
}
export declare function Review({ author, avatarSrc, avatarFallback, rating: score, maxRating, datetime, time, children, actions, className, ...rest }: ReviewProps): import("react").JSX.Element;
