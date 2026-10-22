import type { ComponentPropsWithRef } from "react";
export interface StatisticProps extends ComponentPropsWithRef<"dl"> {
    /** Caller-owned name for the measured value. */
    label: string;
    /** Machine-readable scalar; formatting affects only visible content. */
    value: number | string;
    /** Visible formatting, preserving the data element's machine value. */
    formatValue?: (value: number | string) => string;
    /** Brief paint-only feedback on change; semantics update immediately. */
    animate?: boolean;
    /** Supporting text alongside the value. */
    description?: string;
}
export declare function Statistic({ label, value, formatValue, description, animate, className, ...rest }: StatisticProps): import("react").JSX.Element;
