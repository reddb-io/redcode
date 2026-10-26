const states = {
  complete: "Completed",
  current: "In progress",
  upcoming: "Upcoming",
  blocked: "Blocked",
  failed: "Failed",
  skipped: "Skipped"
};
function journeyStages(items) {
  const ids = /* @__PURE__ */ new Set();
  return items.map((item) => {
    if (!item.id.trim() || ids.has(item.id))
      throw new Error("EntityJourney: stage ids must be nonempty and unique");
    if (!Object.hasOwn(states, item.state))
      throw new Error("EntityJourney: invalid observed state");
    ids.add(item.id);
    const tone = item.state === "failed" ? "danger" : item.state === "blocked" ? "warning" : item.state === "current" ? "info" : item.state === "complete" ? "success" : "neutral";
    return { ...item, tone, stateLabel: item.stateLabel ?? states[item.state] };
  });
}
export {
  journeyStages
};
