function compositeSkeletonShape(model, orientation) {
  const kinds = new Set(model.series.map((series) => series.kind));
  if (kinds.has("candlestick")) return "candlestick";
  if (kinds.size > 1) return "combo";
  if (kinds.has("column")) return orientation === "horizontal" ? "bar" : "column";
  return kinds.has("area") ? "area" : "line";
}
export {
  compositeSkeletonShape
};
