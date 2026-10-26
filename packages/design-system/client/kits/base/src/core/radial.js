function ringThickness(value) {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new Error("Ring thickness must be greater than zero and less than one");
  return value;
}
export {
  ringThickness
};
