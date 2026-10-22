import { type ComponentPropsWithRef } from "react";
import type { InputSize } from "../../src/input.variants";
export interface NumberFieldProps extends Omit<ComponentPropsWithRef<"input">, "type" | "value" | "defaultValue" | "min" | "max" | "step" | "children" | "size"> {
    /** Visible label, also used to name both stepping actions. */
    label: string;
    /** Caller-owned number; null represents an empty field. Invalid typed values retain native validation. */
    value?: number | null;
    /** Initial uncontrolled value, restored by native form reset. */
    defaultValue?: number | null;
    /** Called once for each user edit or step, and after a native form reset. */
    onValueChange?: (value: number | null) => void;
    /** Finite inclusive lower bound, if any. */
    min?: number;
    /** Finite inclusive upper bound; must not be below min. */
    max?: number;
    /** Positive finite native step, based on min or the initial value. Defaults to 1. */
    step?: number;
    /** Supporting text associated with the native input. */
    help?: string;
    /** Application validation message associated with the native input. */
    error?: string;
    /** Shared control height for the input and both buttons. Defaults to md. */
    controlSize?: InputSize;
    /** Accessible decrement action name; defaults to Decrease followed by label. */
    decrementLabel?: string;
    /** Accessible increment action name; defaults to Increase followed by label. */
    incrementLabel?: string;
}
export declare function NumberField({ label, value, defaultValue, onValueChange, min, max, step, help, error, controlSize, decrementLabel, incrementLabel, id, required, disabled, readOnly, className, ref, ...rest }: NumberFieldProps): import("react").JSX.Element;
