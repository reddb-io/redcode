import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { ApplicationShellContract } from "../../src/core/contracts/applicationshell";
export interface ApplicationShellProps extends ApplicationShellContract, Omit<ComponentPropsWithRef<"div">, keyof ApplicationShellContract | "children"> {
    /** Product-wide chrome before the page. */
    header?: ReactNode;
    /** Caller-owned page content. */
    children?: ReactNode;
    /** Product-wide supporting chrome after the page. */
    footer?: ReactNode;
    /** Additional application frame classes. */
    className?: string;
}
export declare function ApplicationShell({ mainId, header, children, footer, fullWidth, embedded, className, ...rest }: ApplicationShellProps): import("react").JSX.Element;
