import type { ComponentPropsWithRef } from "react";
import type { DateValue } from "@internationalized/date";
import { type CalendarContract, type CalendarRange } from "../../src/core/calendar";
export interface RangeCalendarProps extends CalendarContract, Omit<ComponentPropsWithRef<"div">, keyof CalendarContract | "children"> {
    /** Selected range, including a partial start while the end is being chosen. */
    value?: CalendarRange;
    /** Fewest calendar days in the complete inclusive range. */
    minDays?: number;
    /** Most calendar days in the complete inclusive range. */
    maxDays?: number;
    /** Restart at the picked date when a completed range would contain a disabled date. */
    excludeDisabled?: boolean;
    /** Reports complete or cleared selections. */
    onValueChange?: (value: CalendarRange) => void;
    /** Reports the chosen start including incomplete selections. */
    onStartValueChange?: (value: DateValue | undefined) => void;
    /** Reports the chosen end including clearing it to start another selection. */
    onEndValueChange?: (value: DateValue | undefined) => void;
    /** Reports movement of the visible month. */
    onPlaceholderChange?: (value: DateValue) => void;
    /** Additional root classes. */
    className?: string;
}
export declare function RangeCalendar(props: RangeCalendarProps): import("react").JSX.Element;
