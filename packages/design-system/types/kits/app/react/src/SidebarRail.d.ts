import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { SidebarRailContract } from "../../src/core/contracts/sidebarrail";
export interface SidebarRailProps extends SidebarRailContract, Omit<ComponentPropsWithRef<"nav">, keyof SidebarRailContract | "children" | "onSelect"> {
    /** Reports the chosen identity; currentId remains caller-owned. */
    onSelect?: (id: string) => void;
    /** Brand or home control before the roving collection. */
    top?: ReactNode;
    /** Account control after the roving collection. */
    bottom?: ReactNode;
    /** Additional navigation classes. */
    className?: string;
}
export declare function SidebarRail({ label, items, currentId, onSelect, top, bottom, showLabels, itemSize, iconSize, itemGap, railWidth, railPadding, labelSize, style, className, onKeyDown, onFocus, ...rest }: SidebarRailProps): import("react").JSX.Element;
