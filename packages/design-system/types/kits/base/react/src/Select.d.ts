import { type ComponentPropsWithRef } from "react";
import { type SelectSize } from "../../src/select.variants";
import { type SelectOption } from "../../src/core/choices";
export type { SelectOption } from "../../src/core/choices";
export interface SelectProps extends Omit<ComponentPropsWithRef<"select">, "value" | "size"> {
    /** Flat caller-owned options; native children can append options and optgroups. */
    options?: readonly SelectOption[];
    /** Controlled native value, including arrays for a multiple select. */
    value?: ComponentPropsWithRef<"select">["value"];
    /** Initial uncontrolled native value, including arrays for multiple selection. */
    defaultValue?: ComponentPropsWithRef<"select">["defaultValue"];
    /** Called with the first selected native value; onChange retains selectedOptions and its native React event. */
    onValueChange?: (value: string) => void;
    /** The control height step, matching Button's `size` (default `md`). A number is the deprecated native attribute; use `htmlSize` for it. */
    size?: SelectSize | number | null;
    /** Deprecated alias of `size` (ADR 0026), removed in the next month release. */
    controlSize?: SelectSize;
    /** The native `size` attribute: the number of visible rows. */
    htmlSize?: number;
}
export declare function Select({ options, value, size, controlSize: legacySize, htmlSize, className, children, onChange, onValueChange, ref, ...rest }: SelectProps): import("react").JSX.Element;
