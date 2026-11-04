function projectionChartModel(props) {
  const { recorded, projected, now, valueDomain, annotations = [], series = 1, nowLabel = "Now", recordedLabel = "Recorded", projectedLabel = "Projected" } = props;
  if (!Number.isFinite(now)) throw new Error("ProjectionChart: now must be finite");
  if (!valueDomain.every(Number.isFinite) || valueDomain[0] > 0 || valueDomain[1] <= 0 || valueDomain[0] >= valueDomain[1]) throw new Error("ProjectionChart: valueDomain must be finite, increasing and include zero");
  for (const points of [recorded, projected]) for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || i > 0 && point.x < points[i - 1].x) throw new Error("ProjectionChart: points must be finite and ordered by time");
  }
  const ids = /* @__PURE__ */ new Set(["now"]);
  for (const annotation of annotations) {
    if (!annotation.id || ids.has(annotation.id) || !Number.isFinite(annotation.time)) throw new Error("ProjectionChart: annotation ids must be unique and times finite");
    ids.add(annotation.id);
  }
  return { data: [
    { id: "recorded", label: recordedLabel, kind: "area", data: recorded, series, gradient: true, preserveDuplicateX: true },
    { id: "projected", label: projectedLabel, kind: "line", data: projected, series, dash: "dashed", preserveDuplicateX: true }
  ], references: [{ id: "now", label: nowLabel, kind: "sample", x: now, showLabel: true }, ...annotations.map((item) => ({ id: item.id, label: item.label, kind: "sample", x: item.time, showLabel: true }))] };
}
export {
  projectionChartModel
};
