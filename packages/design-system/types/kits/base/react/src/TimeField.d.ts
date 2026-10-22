import type { TimeFieldContract } from "../../src/core/contracts/timefield";
export interface TimeFieldProps extends TimeFieldContract {
    /** Reports complete possible values, or an empty string while incomplete. */
    onValueChange?: (value: string) => void;
    /** Additional Field root classes. */
    className?: string;
}
export declare function TimeField(props: TimeFieldProps): import("react").JSX.Element;
