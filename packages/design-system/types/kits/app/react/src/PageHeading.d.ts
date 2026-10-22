import type { ComponentPropsWithRef, ReactNode } from "react";
import type { PageHeadingContract } from "../../src/core/contracts/pageheading";
export interface PageHeadingProps extends PageHeadingContract, Omit<ComponentPropsWithRef<"div">, keyof PageHeadingContract | "children"> {
    /** Context such as canonical Breadcrumbs. */
    context?: ReactNode;
    /** Canonical links and controls. */
    actions?: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function PageHeading({ title, description, context, actions, className, ...rest }: PageHeadingProps): import("react").JSX.Element;
