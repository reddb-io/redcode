import type { ComponentPropsWithRef } from "react";
import type { FilterContract } from "../../src/core/contracts/filter";
export interface FilterProps extends FilterContract, Omit<ComponentPropsWithRef<"fieldset">, keyof FilterContract | "children" | "defaultValue"> {
    /** Reports an active filter change. */
    onValueChange?: (value: string) => void;
    /** Additional fieldset classes. */
    className?: string;
}
export declare function Filter(props: FilterProps): import("react").JSX.Element;
