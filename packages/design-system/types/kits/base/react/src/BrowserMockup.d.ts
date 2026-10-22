import type { ComponentPropsWithRef, ReactNode } from "react";
export interface BrowserMockupProps extends Omit<ComponentPropsWithRef<"div">, "aria-hidden" | "aria-label" | "children" | "role">, Partial<Record<"aria-hidden" | "aria-label" | "role", never>> {
    /** Optional display-only address. It is never rendered as a link or control. */
    address?: string;
    /** Width divided by viewport height. */
    ratio?: number;
    /** Extra classes merged onto the decorative frame. */
    className?: string;
    /** Caller-owned screenshot, live embed, code sample, or other content. */
    children: ReactNode;
}
export declare function BrowserMockup({ address, ratio, className, children, ...rest }: BrowserMockupProps): import("react").JSX.Element;
