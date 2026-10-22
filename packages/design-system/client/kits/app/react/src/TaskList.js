import { jsx } from "react/jsx-runtime";
import { TaskCard } from "./TaskCard.js";
import { EmptyState } from "@reddb-io/design-system/base";
import {
  validateTasks
} from "../../src/composites/task-list.behavior.js";
import { taskList } from "../../src/composites/task-list.variants.js";
function TaskList({
  label,
  items,
  actions,
  empty,
  emptyLabel = "No tasks",
  emptyDescription,
  className,
  ...rest
}) {
  const tasks = validateTasks(items), styles = taskList();
  return /* @__PURE__ */ jsx("div", { ...rest, "data-task-list": true, className: styles.root({ class: className }), children: tasks.length ? /* @__PURE__ */ jsx("ul", { "aria-label": label, className: styles.list(), children: tasks.map((item) => /* @__PURE__ */ jsx(
    "li",
    {
      "data-task-id": item.id,
      "data-state": item.state,
      className: styles.item(),
      children: /* @__PURE__ */ jsx(TaskCard, { item, surface: false, actions })
    },
    item.id
  )) }) : empty ?? /* @__PURE__ */ jsx(
    EmptyState,
    {
      title: emptyLabel,
      description: emptyDescription,
      size: "sm"
    }
  ) });
}
export {
  TaskList
};
