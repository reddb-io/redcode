import { type ReactNode } from "react";
import type { DisclosureContract } from "../../src/core/contracts/disclosure";
export interface DisclosureProps extends DisclosureContract {
    /** Content rendered only while expanded. */
    children?: ReactNode;
    /** Called with the next open state. */
    onOpenChange?: (open: boolean) => void;
    /** Additional root classes. */
    className?: string;
}
export declare function Disclosure(props: DisclosureProps): import("react").JSX.Element;
