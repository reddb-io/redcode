import { type Ref } from "react";
/** Native adapter state keeps React's change tracking aligned after form reset. */
export declare function useBinaryChoice(checked: boolean | undefined, defaultChecked: boolean | undefined, ref: Ref<HTMLInputElement> | undefined, form: string | undefined): {
    element: import("react").RefObject<HTMLInputElement | null>;
    current: boolean;
    update: (next: boolean) => void;
};
