import { type ReactNode } from "react";
import type { DateRangePickerContract } from "../../src/core/contracts/daterangepicker";
export interface DateRangePickerProps extends DateRangePickerContract {
    /** Custom trigger content inside the canonical Button. */
    trigger?: ReactNode;
    /** Additional root classes. */
    className?: string;
    /** Reports both ISO bounds after an edit or a completed Calendar selection. */
    onValueChange?: (value: {
        start: string;
        end: string;
    }) => void;
    /** Reports changes to the calendar overlay's open state. */
    onOpenChange?: (open: boolean) => void;
}
export declare function DateRangePicker(props: DateRangePickerProps): import("react").JSX.Element;
