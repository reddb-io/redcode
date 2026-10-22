import { type ReactNode } from "react";
import type { TabsContract } from "../../src/core/contracts/tabs";
export interface TabsProps extends TabsContract {
    /** Called with a newly selected tab value. */
    onValueChange?: (value: string) => void;
    /** Caller-owned content rendered in each panel, receiving its stable value. */
    children?: (item: {
        value: string;
    }) => ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function Tabs(props: TabsProps): import("react").JSX.Element;
