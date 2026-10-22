import { type ComponentPropsWithRef } from "react";
import type { CategoryFilterContract } from "../../src/core/contracts/categoryfilter";
export interface CategoryFilterProps extends CategoryFilterContract, Omit<ComponentPropsWithRef<"fieldset">, keyof CategoryFilterContract | "children" | "defaultValue"> {
    /** Reports selected categories in selection order. */
    onValueChange?: (value: string[]) => void;
    /** Additional fieldset classes. */
    className?: string;
}
export declare function CategoryFilter(props: CategoryFilterProps): import("react").JSX.Element;
