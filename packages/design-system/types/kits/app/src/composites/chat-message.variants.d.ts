import { type VariantProps } from "tailwind-variants";
/** Density-responsive message rhythm around canonical Base media contracts. */
export declare const chatMessage: import("tailwind-variants").TVReturnType<{
    speaker: {
        user: {};
        assistant: {
            root: string;
        };
        system: {
            root: string;
            body: string;
        };
    };
}, {
    root: string;
    content: string;
    header: string;
    author: string;
    time: string;
    body: string;
    actions: string;
    note: string;
    failure: string;
    announcement: string;
}, undefined, {
    speaker: {
        user: {};
        assistant: {
            root: string;
        };
        system: {
            root: string;
            body: string;
        };
    };
}, {
    root: string;
    content: string;
    header: string;
    author: string;
    time: string;
    body: string;
    actions: string;
    note: string;
    failure: string;
    announcement: string;
}, import("tailwind-variants").TVReturnType<{
    speaker: {
        user: {};
        assistant: {
            root: string;
        };
        system: {
            root: string;
            body: string;
        };
    };
}, {
    root: string;
    content: string;
    header: string;
    author: string;
    time: string;
    body: string;
    actions: string;
    note: string;
    failure: string;
    announcement: string;
}, undefined, unknown, unknown, undefined>>;
export type ChatMessageVariants = VariantProps<typeof chatMessage>;
