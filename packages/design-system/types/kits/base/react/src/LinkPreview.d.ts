import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { LinkPreviewContract } from "../../src/core/contracts/linkpreview";
export interface LinkPreviewProps extends LinkPreviewContract, Omit<ComponentPropsWithRef<"a">, keyof LinkPreviewContract | "aria-controls" | "aria-expanded" | "aria-haspopup" | "children" | "role"> {
    /** Optional custom native link content. */
    trigger?: ReactNode;
    /** Noninteractive preview content. */
    children?: ReactNode;
    /** Additional preview surface classes. */
    className?: string;
    /** Reports open-state changes. */
    onOpenChange?: (open: boolean) => void;
}
export declare function LinkPreview(props: LinkPreviewProps): import("react").JSX.Element;
