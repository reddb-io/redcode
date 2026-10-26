function reviewChanges(items) {
  const ids = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (!item.id.trim() || ids.has(item.id))
      throw new Error("ChangeReview requires unique non-empty ids.");
    if (item.state && !["pending", "applying", "applied", "failed"].includes(item.state))
      throw new Error("Unknown review state.");
    ids.add(item.id);
  }
  return {
    items,
    actionable: items.filter((item) => item.state !== "applied").map((item) => item.id),
    applying: items.some((item) => item.state === "applying")
  };
}
export {
  reviewChanges
};
