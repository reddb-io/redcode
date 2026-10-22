import { type Ref } from "react";
import { type InlineEditContract } from "../../src/core/inline-edit";
export interface InlineEditProps extends Omit<InlineEditContract, "maxlength"> {
    /** Reports a committed value after validation and persistence succeed. */
    onValueChange?: (value: string) => void;
    /** Reports a request to enter or exit editing. */
    onEditingChange?: (editing: boolean) => void;
    /** Optional persistence operation. A rejection keeps the draft open. */
    onConfirm?: (value: string) => void | Promise<void>;
    /** Optional maximum number of characters accepted by the native input. */
    maxLength?: number;
    /** Extra classes on the field group. */
    className?: string;
    /** Native field-group ref. */
    ref?: Ref<HTMLDivElement>;
}
export declare function InlineEdit({ label, value, editing, defaultEditing, onValueChange, onEditingChange, validate, onConfirm, disabled, required, maxLength, emptyLabel, editLabel, saveLabel, cancelLabel, requiredMessage, saveErrorMessage, className, ref }: InlineEditProps): import("react").JSX.Element;
