function numberConstraints(min, max, step) {
  if (min !== void 0 && !Number.isFinite(min) || max !== void 0 && !Number.isFinite(max) || !Number.isFinite(step) || step <= 0 || min !== void 0 && max !== void 0 && max < min) {
    throw new Error("NumberField: use finite bounds, max >= min, and a positive finite step.");
  }
  return { min, max, step };
}
export {
  numberConstraints
};
