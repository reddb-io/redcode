import type { TimeRangeFieldContract } from "../../src/core/contracts/timerangefield";
export interface TimeRangeFieldProps extends TimeRangeFieldContract {
    /** Reports both bounds after a user change. */
    onValueChange?: (value: {
        start: string;
        end: string;
    }) => void;
    /** Additional native Fieldset classes. */
    className?: string;
}
export declare function TimeRangeField(props: TimeRangeFieldProps): import("react").JSX.Element;
