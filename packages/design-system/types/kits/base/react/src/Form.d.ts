import type { ComponentPropsWithRef } from "react";
export type FormProps = ComponentPropsWithRef<"form">;
/** Native submission, validation, reset and refs; no client runtime boundary. */
export declare function Form({ className, ...rest }: FormProps): import("react").JSX.Element;
