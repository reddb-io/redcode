import type { ComponentPropsWithRef, ReactNode } from "react";
export interface WindowMockupProps extends Omit<ComponentPropsWithRef<"div">, "aria-hidden" | "aria-label" | "children" | "role" | "title">, Partial<Record<"aria-hidden" | "aria-label" | "role", never>> {
    /** Optional display-only title for the decorative title bar. */
    title?: string;
    /** Width divided by viewport height. */
    ratio?: number;
    /** Extra classes merged onto the decorative frame. */
    className?: string;
    /** Caller-owned screenshot, live embed, code sample, or other content. */
    children: ReactNode;
}
export declare function WindowMockup({ title, ratio, className, children, ...rest }: WindowMockupProps): import("react").JSX.Element;
