import type { DateRangeFieldContract } from "../../src/core/contracts/daterangefield";
export interface DateRangeFieldProps extends DateRangeFieldContract {
    /** Reports both bounds after a user change. */
    onValueChange?: (value: {
        start: string;
        end: string;
    }) => void;
    /** Additional native Fieldset classes. */
    className?: string;
}
export declare function DateRangeField(props: DateRangeFieldProps): import("react").JSX.Element;
