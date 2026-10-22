const TASK_STATES = ["queued", "running", "paused", "blocked", "succeeded", "failed", "cancelled"];
const TASK_STATE_LABELS = {
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  blocked: "Blocked",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled"
};
const TASK_STATE_TONES = {
  queued: "neutral",
  running: "info",
  paused: "neutral",
  blocked: "warning",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral"
};
function validateTasks(items) {
  const ids = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) throw new Error("TaskList: task ids must be non-empty and unique.");
    if (!TASK_STATES.includes(item.state)) throw new Error(`TaskList: unknown state for ${item.id}.`);
    if (item.progress !== void 0 && item.progress !== null && !Number.isFinite(item.progress)) throw new Error("TaskList: progress must be finite, null or omitted.");
    ids.add(item.id);
  }
  return items;
}
export {
  TASK_STATES,
  TASK_STATE_LABELS,
  TASK_STATE_TONES,
  validateTasks
};
