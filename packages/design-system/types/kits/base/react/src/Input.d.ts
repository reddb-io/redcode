import type { ComponentPropsWithRef, HTMLInputTypeAttribute } from "react";
import { type InputSize } from "../../src/input.variants";
import { type InputValue } from "../../src/core/input";
export interface InputProps<Type extends HTMLInputTypeAttribute = "text"> extends Omit<ComponentPropsWithRef<"input">, "type" | "value"> {
    /** Native input type, text by default. */
    type?: Type;
    /** Controlled native value; null clears a numeric input. */
    value?: ComponentPropsWithRef<"input">["value"] | null;
    /** Height step, separate from the native size attribute. */
    controlSize?: InputSize;
    /** Native value: numbers/null for number and range, strings otherwise. onChange still receives its React event. */
    onValueChange?: (value: InputValue<Type>) => void;
}
/** Controlled value/onValueChange or native uncontrolled defaultValue. */
export declare function Input<Type extends HTMLInputTypeAttribute = "text">({ controlSize, type, value, className, onChange, onValueChange, ref, ...rest }: InputProps<Type>): import("react").JSX.Element;
