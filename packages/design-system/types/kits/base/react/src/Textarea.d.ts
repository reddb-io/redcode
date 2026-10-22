import type { ComponentPropsWithRef } from "react";
export interface TextareaProps extends ComponentPropsWithRef<"textarea"> {
    /** New native string value; onChange still receives its React event. */
    onValueChange?: (value: string) => void;
}
export declare function Textarea({ className, onChange, onValueChange, ...rest }: TextareaProps): import("react").JSX.Element;
