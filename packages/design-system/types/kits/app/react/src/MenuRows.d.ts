import { type DropdownMenuEntry } from "@reddb-io/design-system/base";
import type { ContextMenuSize } from "../../src/composites/context-menu.variants";
interface MenuRowsProps {
    items: readonly DropdownMenuEntry[];
    size: ContextMenuSize;
    slots: Record<"group" | "separator" | "heading" | "icon" | "item", () => string>;
}
export declare function MenuRows({ items, size, slots }: MenuRowsProps): import("react").JSX.Element;
export {};
