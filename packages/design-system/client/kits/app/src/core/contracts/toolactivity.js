const TOOL_STEP_STATUSES = ["running", "succeeded", "failed", "cancelled"];
const TOOL_STEP_STATUS_LABELS = {
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled"
};
function toolActivityState(steps) {
  if (steps.some((step) => step.status === "running")) return "running";
  return steps.some((step) => step.status === "failed") ? "failed" : "done";
}
export {
  TOOL_STEP_STATUSES,
  TOOL_STEP_STATUS_LABELS,
  toolActivityState
};
