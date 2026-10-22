import type { DateFieldContract } from "../../src/core/contracts/datefield";
export interface DateFieldProps extends DateFieldContract {
    /** Reports complete possible values, or an empty string while incomplete. */
    onValueChange?: (value: string) => void;
    /** Additional Field root classes. */
    className?: string;
}
export declare function DateField(props: DateFieldProps): import("react").JSX.Element;
