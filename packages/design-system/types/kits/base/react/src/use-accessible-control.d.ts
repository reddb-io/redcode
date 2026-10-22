import { type Ref } from "react";
/** Native refs and lifecycle only; both renderers run the same DOM diagnostics. */
export declare function useAccessibleControl<T extends HTMLElement>(component: string, ref?: Ref<T>, fromContent?: boolean): import("react").RefObject<T | null>;
