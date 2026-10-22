import { type VariantProps } from "tailwind-variants";
/**
 * The application frame's structural appearance. Every inset names a live
 * Density role; colour names remain semantic so nested appearance scopes keep
 * deciding what the shell looks like.
 */
export declare const applicationShell: import("tailwind-variants").TVReturnType<{
    fullWidth: {
        true: {
            header: string;
            headerContainer: string;
        };
        false: {
            header: string;
            headerContainer: string;
        };
    };
}, {
    root: string;
    header: string;
    headerContainer: string;
    main: string;
    mainContainer: string;
    footer: string;
    footerContainer: string;
}, undefined, {
    fullWidth: {
        true: {
            header: string;
            headerContainer: string;
        };
        false: {
            header: string;
            headerContainer: string;
        };
    };
}, {
    root: string;
    header: string;
    headerContainer: string;
    main: string;
    mainContainer: string;
    footer: string;
    footerContainer: string;
}, import("tailwind-variants").TVReturnType<{
    fullWidth: {
        true: {
            header: string;
            headerContainer: string;
        };
        false: {
            header: string;
            headerContainer: string;
        };
    };
}, {
    root: string;
    header: string;
    headerContainer: string;
    main: string;
    mainContainer: string;
    footer: string;
    footerContainer: string;
}, undefined, unknown, unknown, undefined>>;
export type ApplicationShellVariants = VariantProps<typeof applicationShell>;
