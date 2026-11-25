function usageTone(used, limit, thresholds = { warning: 0.75, danger: 0.9 }) {
  const share = limit > 0 ? used / limit : 0;
  if (share >= thresholds.danger) return "danger";
  return share >= thresholds.warning ? "warning" : "neutral";
}
export {
  usageTone
};
