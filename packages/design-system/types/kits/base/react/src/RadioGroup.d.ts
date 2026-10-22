import { type ComponentPropsWithRef, type ReactNode } from "react";
import { type RadioGroupOption } from "../../src/radio-group.variants";
export type { RadioGroupOption } from "../../src/radio-group.variants";
export interface RadioGroupProps extends Omit<ComponentPropsWithRef<"fieldset">, "children" | "name"> {
    /** Required visible group name rendered as a native legend. */
    legend: string;
    /** Native form name shared by the radios. */
    name: string;
    /** Caller-owned choices, including descriptions and disabled reasons. */
    options: readonly RadioGroupOption[];
    /** Native radio rows or rich bordered cards. */
    variant?: "list" | "cards";
    /** Noninteractive option media; the canonical label and description retain their semantics. */
    optionMedia?: (option: RadioGroupOption) => ReactNode;
    /** Controlled selected value. */
    value?: string;
    /** Initial uncontrolled value, restored by native form reset. */
    defaultValue?: string;
    /** Called with the newly chosen value. */
    onValueChange?: (value: string) => void;
    /** Require a selection before native submission. */
    required?: boolean;
    /** Supporting text announced with every radio. */
    help?: string;
    /** Current group validation error. */
    error?: string;
    /** Extra classes merged onto every label. */
    optionClass?: string;
    /** Extra classes merged onto every radio. */
    controlClass?: string;
}
export declare function RadioGroup({ legend, name, options, variant, optionMedia, value, defaultValue, onValueChange, required, help, error, id, className, optionClass, controlClass, ref, ...rest }: RadioGroupProps): import("react").JSX.Element;
