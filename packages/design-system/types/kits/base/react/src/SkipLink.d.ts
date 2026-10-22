import type { ComponentPropsWithRef } from "react";
export interface SkipLinkProps extends ComponentPropsWithRef<"a"> {
    /** In-page destination; defaults to the shared main-content landmark. */
    href?: string;
}
export declare function SkipLink({ href, onClick, className, children, ...rest }: SkipLinkProps): import("react").JSX.Element;
