function kpiDeltaDirection(delta) {
  if (delta > 0)
    return "increase";
  if (delta < 0)
    return "decrease";
  return "unchanged";
}
function kpiDeltaSentiment(delta, polarity = "higher-is-better") {
  const direction = kpiDeltaDirection(delta);
  if (direction === "unchanged" || polarity === "neutral")
    return "neutral";
  const better = polarity === "higher-is-better" ? "increase" : "decrease";
  return direction === better ? "improvement" : "regression";
}
import { DEPRECATED_KPI_CARD_TONES, KPI_CARD_TONES } from "../kpi-card.variants.js";
function formatKpiDelta(delta, suffix = "%") {
  return `${delta > 0 ? "+" : ""}${delta}${suffix}`;
}
export {
  DEPRECATED_KPI_CARD_TONES,
  KPI_CARD_TONES,
  formatKpiDelta,
  kpiDeltaDirection,
  kpiDeltaSentiment
};
