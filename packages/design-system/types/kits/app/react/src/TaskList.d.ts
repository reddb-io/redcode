import type { ComponentPropsWithRef, ReactNode } from "react";
import { type TaskListItem } from "../../src/composites/task-list.behavior";
import type { TaskListContract } from "../../src/core/contracts/tasklist";
export interface TaskListProps extends TaskListContract, Omit<ComponentPropsWithRef<"div">, keyof TaskListContract | "children"> {
    /** Controls for one task; execution stays caller-owned. */
    actions?: (item: TaskListItem) => ReactNode;
    /** Replaces the canonical empty state. */
    empty?: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function TaskList({ label, items, actions, empty, emptyLabel, emptyDescription, className, ...rest }: TaskListProps): import("react").JSX.Element;
