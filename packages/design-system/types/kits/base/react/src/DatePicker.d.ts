import { type ReactNode } from "react";
import type { DatePickerContract } from "../../src/core/contracts/datepicker";
export interface DatePickerProps extends DatePickerContract {
    /** Custom trigger content inside the canonical Button. */
    trigger?: ReactNode;
    /** Additional root classes. */
    className?: string;
    /** Reports complete dates selected in the Calendar or edited in the field. */
    onValueChange?: (value: string) => void;
    /** Reports changes to the calendar overlay's open state. */
    onOpenChange?: (open: boolean) => void;
}
export declare function DatePicker(props: DatePickerProps): import("react").JSX.Element;
