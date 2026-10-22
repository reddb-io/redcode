import { type ReactNode } from "react";
import { type IconGlyph } from "./Icon";
import { type DropdownMenuEntry as PortableEntry, type DropdownMenuItem as PortableItem } from "../../src/core/dropdown-menu";
import { type DropdownMenuSize } from "../../src/dropdown-menu.variants";
import type { ButtonVariant } from "../../src/button.variants";
export type DropdownMenuEntry = PortableEntry<IconGlyph>;
export type DropdownMenuItem = PortableItem<IconGlyph>;
type Side = "top" | "right" | "bottom" | "left";
type Align = "start" | "center" | "end";
export interface DropdownMenuProps {
    /** Accessible and fallback visible name of the canonical trigger. */
    triggerLabel: string;
    /** Accessible name of the opened menu surface. */
    contentLabel: string;
    /** Ordered rows and named or unnamed groups. */
    items?: readonly DropdownMenuEntry[];
    /** Controlled open state. */
    open?: boolean;
    /** Reports requested open-state changes. */
    onOpenChange?: (open: boolean) => void;
    /** Emphasis of the trigger Button. */
    variant?: ButtonVariant;
    /** Trigger and menu-row size on the Density scale. */
    size?: DropdownMenuSize;
    /** Preferred trigger side, flipped when necessary to remain in view. */
    side?: Side;
    /** Preferred alignment along the selected side. */
    align?: Align;
    /** Distance in pixels between trigger and menu. */
    sideOffset?: number;
    /** Safe viewport collision inset in pixels. */
    collisionPadding?: number;
    /** Custom trigger content named by triggerLabel. */
    trigger?: ReactNode;
    /** Additional menu surface classes. */
    className?: string;
}
export declare function DropdownMenu(props: DropdownMenuProps): import("react").JSX.Element;
export {};
