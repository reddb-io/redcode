import type { ComponentPropsWithRef } from "react";
import type { DateValue } from "@internationalized/date";
import type { CalendarContract } from "../../src/core/calendar";
export interface CalendarProps extends CalendarContract, Omit<ComponentPropsWithRef<"div">, keyof CalendarContract | "children"> {
    /** Focus the selected date, today or first enabled day on mount. */
    initialFocus?: boolean;
    /** Selected date; omit for an empty selection. */
    value?: DateValue;
    /** Reports the selected date, or undefined after clearing the selection. */
    onValueChange?: (value: DateValue | undefined) => void;
    /** Reports movement of the visible month. */
    onPlaceholderChange?: (value: DateValue) => void;
    /** Additional root classes. */
    className?: string;
}
export declare function Calendar(props: CalendarProps): import("react").JSX.Element;
