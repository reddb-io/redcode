import type { ComponentPropsWithRef, ReactNode } from "react";
export interface PhoneMockupProps extends Omit<ComponentPropsWithRef<"div">, "aria-hidden" | "aria-label" | "children" | "role">, Partial<Record<"aria-hidden" | "aria-label" | "role", never>> {
    /** Width divided by viewport height. */
    ratio?: number;
    /** Extra classes merged onto the decorative phone body. */
    className?: string;
    /** Caller-owned screenshot, live embed, code sample, or other content. */
    children: ReactNode;
}
export declare function PhoneMockup({ ratio, className, children, ...rest }: PhoneMockupProps): import("react").JSX.Element;
