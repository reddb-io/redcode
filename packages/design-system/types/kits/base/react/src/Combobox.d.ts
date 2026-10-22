import type { ComboboxContract } from "../../src/core/contracts/combobox";
export interface ComboboxProps extends ComboboxContract {
    /** Additional classes on the Field root. */
    className?: string;
    /** Reports a newly selected value. */
    onValueChange?: (value: string) => void;
    /** Reports typed text and the selected option's label. */
    onInputValueChange?: (value: string) => void;
    /** Reports changes to the anchored listbox's open state. */
    onOpenChange?: (open: boolean) => void;
}
export declare function Combobox(props: ComboboxProps): import("react").JSX.Element;
