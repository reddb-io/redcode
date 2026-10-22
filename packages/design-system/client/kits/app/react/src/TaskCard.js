import { jsx, jsxs } from "react/jsx-runtime";
import {
  Link,
  Progress,
  StatusIndicator,
  formatPercent,
  normalizeRange
} from "@reddb-io/design-system/base";
import {
  TASK_STATE_LABELS,
  TASK_STATE_TONES,
  validateTasks
} from "../../src/composites/task-list.behavior.js";
import { taskList } from "../../src/composites/task-list.variants.js";
import { operational } from "../../src/operational.variants.js";
function TaskCard({
  item,
  surface = true,
  actions,
  className
}) {
  const task = validateTasks([item])[0], slots = taskList(), frame = operational();
  return /* @__PURE__ */ jsxs(
    "div",
    {
      "data-task-card": true,
      "data-state": task.state,
      className: [surface ? frame.root() : "", frame.body(), className].filter(Boolean).join(" "),
      children: [
        /* @__PURE__ */ jsxs("div", { className: slots.header(), children: [
          /* @__PURE__ */ jsx("p", { className: slots.title(), children: task.href ? /* @__PURE__ */ jsx(Link, { href: task.href, children: task.title }) : task.title }),
          /* @__PURE__ */ jsx(
            StatusIndicator,
            {
              label: task.stateLabel ?? TASK_STATE_LABELS[task.state],
              tone: task.tone ?? TASK_STATE_TONES[task.state]
            }
          )
        ] }),
        task.description && /* @__PURE__ */ jsx("p", { className: slots.description(), children: task.description }),
        task.progress !== void 0 && /* @__PURE__ */ jsxs("div", { className: slots.progress(), children: [
          /* @__PURE__ */ jsx(
            Progress,
            {
              label: `${task.title} progress`,
              value: task.progress,
              formatValue: task.progressLabel ? () => task.progressLabel : void 0,
              className: "min-w-0 flex-1"
            }
          ),
          task.progress !== null && /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: slots.reading(), children: task.progressLabel ?? formatPercent(normalizeRange(task.progress, 0, 100)) })
        ] }),
        (task.worker || task.estimate) && /* @__PURE__ */ jsxs("div", { className: slots.context(), children: [
          task.worker && /* @__PURE__ */ jsx("span", { children: task.worker }),
          task.estimate && /* @__PURE__ */ jsx("span", { children: task.estimate })
        ] }),
        task.reason && /* @__PURE__ */ jsx("p", { className: slots.reason(), children: task.reason }),
        actions && /* @__PURE__ */ jsx("div", { className: slots.actions(), children: actions(task) })
      ]
    }
  );
}
export {
  TaskCard
};
