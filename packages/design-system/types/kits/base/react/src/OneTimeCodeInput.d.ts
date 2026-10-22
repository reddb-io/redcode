import { type ComponentPropsWithRef } from "react";
import { type OneTimeCodeInputMode } from "../../src/core/one-time-code";
export interface OneTimeCodeInputProps extends Omit<ComponentPropsWithRef<"fieldset">, "children"> {
    /** Required visible accessible name rendered as the native legend. */
    label: string;
    /** Native form name receiving the complete code. */
    name?: string;
    /** Positive integer number of one-character segments. Defaults to 6. */
    length?: number;
    /** Complete caller-owned code. */
    value?: string;
    /** Initial uncontrolled code, restored by native form reset. Defaults to empty. */
    defaultValue?: string;
    /** Supporting text associated with every segment. */
    help?: string;
    /** Current validation error announced and associated with every segment. */
    error?: string;
    /** Applies native required validation to every segment. */
    required?: boolean;
    /** Native input mode used by every segment. Defaults to numeric. */
    inputMode?: OneTimeCodeInputMode;
    /** Native pattern used by every segment. Defaults to [0-9]*. */
    pattern?: string;
    /** Called when every segment contains a character. */
    onComplete?: (value: string) => void;
    /** Called with a changed code after user input or paste. */
    onValueChange?: (value: string) => void;
    /** Extra classes merged onto every native segment. */
    segmentClass?: string;
}
export declare function OneTimeCodeInput({ label, name, length, value, defaultValue, help, error, required, inputMode, pattern, id, onComplete, onValueChange, className, segmentClass, ref, ...rest }: OneTimeCodeInputProps): import("react").JSX.Element;
