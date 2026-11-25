import type { ComponentPropsWithRef, HTMLInputTypeAttribute } from "react";
import { type InputSize } from "../../src/input.variants";
import { type InputValue } from "../../src/core/input";
export interface InputProps<Type extends HTMLInputTypeAttribute = "text"> extends Omit<ComponentPropsWithRef<"input">, "type" | "value" | "size"> {
    /** Native input type, text by default. */
    type?: Type;
    /** Controlled native value; null clears a numeric input. */
    value?: ComponentPropsWithRef<"input">["value"] | null;
    /** The control height step, matching Button's `size` (default `md`). A number is the deprecated native attribute; use `htmlSize` for it. */
    size?: InputSize | number | null;
    /** Deprecated alias of `size` (ADR 0026), removed in the next month release. */
    controlSize?: InputSize;
    /** The native `size` attribute: the visible width in characters. */
    htmlSize?: number;
    /** Native value: numbers/null for number and range, strings otherwise. onChange still receives its React event. */
    onValueChange?: (value: InputValue<Type>) => void;
}
/** Controlled value/onValueChange or native uncontrolled defaultValue. */
export declare function Input<Type extends HTMLInputTypeAttribute = "text">({ size, controlSize: legacySize, htmlSize, type, value, className, onChange, onValueChange, ref, ...rest }: InputProps<Type>): import("react").JSX.Element;
