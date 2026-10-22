import type { SearchSelectContract } from "../../src/core/contracts/searchselect";
interface Common extends SearchSelectContract {
    /** Additional Field root classes. */
    className?: string;
    /** Reports changes to the searchable popup's open state. */
    onOpenChange?: (open: boolean) => void;
}
interface Single extends Common {
    /** Enable multiple selection with removable chips; defaults to false. */
    multiple?: false;
    /** Selected option value. */
    value?: string;
    /** Reports selection, removal and clearing. */
    onValueChange?: (value: string) => void;
}
interface Multiple extends Common {
    /** Enable multiple selection with removable chips. */
    multiple: true;
    /** Selected option values. */
    value?: string[];
    /** Reports selection, removal and clearing. */
    onValueChange?: (value: string[]) => void;
}
export type SearchSelectProps = Single | Multiple;
export declare function SearchSelect(props: SearchSelectProps): import("react").JSX.Element;
export {};
