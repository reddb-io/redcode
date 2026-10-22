import { type ComponentPropsWithRef } from "react";
export interface FileInputProps extends Omit<ComponentPropsWithRef<"input">, "children" | "type" | "value" | "defaultValue"> {
    /** Required visible accessible name supplied through Field. */
    label: string;
    /** Supporting text announced with the file control. */
    help?: string;
    /** Validation error associated with the file control. */
    error?: string;
    /** Makes the requirement visible and native. */
    required?: boolean;
    /** Controlled native files; null clears the selection. Omit for native selection. */
    files?: FileList | null;
    /** Called with the native FileList after user selection. */
    onFilesChange?: (files: FileList | null) => void;
    /** Extra classes merged onto the containing Field. */
    fieldClass?: string;
}
export declare function FileInput({ label, help, error, required, id, files, onFilesChange, ref, className, fieldClass, multiple, onChange, ...rest }: FileInputProps): import("react").JSX.Element;
