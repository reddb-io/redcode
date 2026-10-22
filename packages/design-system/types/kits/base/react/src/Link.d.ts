import type { ComponentPropsWithRef, ReactNode } from "react";
export interface LinkProps extends Omit<ComponentPropsWithRef<"a">, "children" | "href"> {
    /** Destination of the link. Required: the element is always a native anchor. */
    href: string;
    /** Extra classes merged onto the canonical link appearance. */
    className?: string;
    /** The link text or content. */
    children?: ReactNode;
}
export declare function Link({ href, className, children, ...rest }: LinkProps): import("react").JSX.Element;
