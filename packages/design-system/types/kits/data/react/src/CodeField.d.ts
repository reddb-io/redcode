import type { CodeFieldContract } from "../../src/core/contracts/codefield";
export * from "../../src/code-field";
export interface CodeFieldProps extends CodeFieldContract {
    /** Reports edits and accepted completions. */
    onValueChange?: (value: string) => void;
    /** Additional outer field classes. */
    className?: string;
}
export declare function CodeField(props: CodeFieldProps): import("react").JSX.Element;
export default CodeField;
