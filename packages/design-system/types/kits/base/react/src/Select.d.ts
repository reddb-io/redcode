import { type ComponentPropsWithRef } from "react";
import { type SelectSize } from "../../src/select.variants";
import { type SelectOption } from "../../src/core/choices";
export type { SelectOption } from "../../src/core/choices";
export interface SelectProps extends Omit<ComponentPropsWithRef<"select">, "value"> {
    /** Flat caller-owned options; native children can append options and optgroups. */
    options?: readonly SelectOption[];
    /** Controlled native value, including arrays for a multiple select. */
    value?: ComponentPropsWithRef<"select">["value"];
    /** Initial uncontrolled native value, including arrays for multiple selection. */
    defaultValue?: ComponentPropsWithRef<"select">["defaultValue"];
    /** Called with the first selected native value; onChange retains selectedOptions and its native React event. */
    onValueChange?: (value: string) => void;
    /** Density-responsive height step, separate from native size. */
    controlSize?: SelectSize;
}
export declare function Select({ options, value, controlSize, className, children, onChange, onValueChange, ref, ...rest }: SelectProps): import("react").JSX.Element;
