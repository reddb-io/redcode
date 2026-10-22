import type { ComponentPropsWithRef, ReactNode } from "react";
import type { CardHeadingContract } from "../../src/core/contracts/cardheading";
export interface CardHeadingProps extends CardHeadingContract, Omit<ComponentPropsWithRef<"div">, keyof CardHeadingContract | "children"> {
    /** Controls at the end of the heading row. */
    actions?: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function CardHeading({ title, description, level, size, actions, className, ...rest }: CardHeadingProps): import("react").JSX.Element;
