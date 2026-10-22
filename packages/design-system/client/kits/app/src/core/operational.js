const GATE_LABELS = {
  pending: "Pending",
  running: "Running",
  passed: "Passed",
  failed: "Failed"
};
const GATE_TONES = {
  pending: "neutral",
  running: "info",
  passed: "success",
  failed: "danger"
};
function validateGates(gates) {
  const ids = /* @__PURE__ */ new Set();
  for (const gate of gates) {
    if (!gate.id || ids.has(gate.id) || !Object.hasOwn(GATE_LABELS, gate.state))
      throw new Error(
        "PhaseSummary: gates require unique ids and known states"
      );
    ids.add(gate.id);
  }
  return gates;
}
const PLAYBACK_SPEEDS = [
  { value: "0.5", label: "0.5\xD7" },
  { value: "1", label: "1\xD7" },
  { value: "2", label: "2\xD7" },
  { value: "4", label: "4\xD7" }
];
export {
  GATE_LABELS,
  GATE_TONES,
  PLAYBACK_SPEEDS,
  validateGates
};
