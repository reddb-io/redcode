import { type ComponentPropsWithRef } from "react";
import type { DiffContract } from "../../src/core/contracts/diff";
export interface DiffProps extends DiffContract, Omit<ComponentPropsWithRef<"div">, keyof DiffContract | "children" | "role"> {
    /** Additional comparison surface classes. */
    className?: string;
}
export declare function Diff({ label, rows, mode, beforeLabel, afterLabel, separatorLabel, className, ...rest }: DiffProps): import("react").JSX.Element;
