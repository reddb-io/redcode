const SPLIT_ORIENTATIONS = ["horizontal", "vertical"];
const SPLIT_BOUNDS = { min: 0.1, max: 0.9 };
const SPLIT_STEP = 0.02;
function ordered(bounds) {
  return { min: Math.min(bounds.min, bounds.max), max: Math.max(bounds.min, bounds.max) };
}
function clampFraction(fraction, bounds = SPLIT_BOUNDS) {
  const { min, max } = ordered(bounds);
  if (!Number.isFinite(fraction)) return clampFraction(0.5, bounds);
  return Math.min(max, Math.max(min, fraction));
}
function fractionAt(offset, size, bounds = SPLIT_BOUNDS) {
  if (!Number.isFinite(offset) || !Number.isFinite(size) || size <= 0) return null;
  return clampFraction(offset / size, bounds);
}
function fractionForKey(key, fraction, orientation, bounds = SPLIT_BOUNDS, step = SPLIT_STEP) {
  const current = clampFraction(fraction, bounds);
  const { min, max } = ordered(bounds);
  if (key === "Home") return min;
  if (key === "End") return max;
  const back = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  const forward = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  if (key === back) return clampFraction(current - step, bounds);
  if (key === forward) return clampFraction(current + step, bounds);
  return null;
}
function percentOf(fraction) {
  return `${Math.round(clampFraction(fraction, { min: 0, max: 1 }) * 1e3) / 10}%`;
}
function separatorOrientation(orientation) {
  return orientation === "horizontal" ? "vertical" : "horizontal";
}
export {
  SPLIT_BOUNDS,
  SPLIT_ORIENTATIONS,
  SPLIT_STEP,
  clampFraction,
  fractionAt,
  fractionForKey,
  percentOf,
  separatorOrientation
};
