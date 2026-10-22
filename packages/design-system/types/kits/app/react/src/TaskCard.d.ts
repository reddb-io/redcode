import type { ReactNode } from "react";
import type { TaskCardContract } from "../../src/core/contracts/taskcard";
import { type TaskListItem } from "../../src/composites/task-list.behavior";
export interface TaskCardProps extends TaskCardContract {
    /** Application-owned controls; the card never schedules work. */
    actions?: (item: TaskListItem) => ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function TaskCard({ item, surface, actions, className, }: TaskCardProps): import("react").JSX.Element;
