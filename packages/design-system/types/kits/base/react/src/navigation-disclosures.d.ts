export { createNavigationDisclosures } from "../../src/core/navigation-disclosures";
export declare const NavigationDisclosureContext: import("react").Context<{
    register(close: () => void): {
        open(): void;
        destroy(): void;
    };
} | undefined>;
/** Join the nearest shell's disclosure scope; a standalone control stays independent. */
export declare function useNavigationDisclosure(open: boolean, close: () => void): void;
