function shellBrandRegion({
  navbar = false,
  rail = false
} = {}) {
  if (navbar) return "navbar";
  if (rail) return "rail";
  return "panel";
}
export {
  shellBrandRegion
};
