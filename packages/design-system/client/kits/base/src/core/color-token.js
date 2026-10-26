function tokenColor(token, fallback) {
  if (token === void 0) return fallback;
  if (!/^--[a-zA-Z_][a-zA-Z0-9_-]*$/.test(token)) throw new Error("Color must name a CSS custom property");
  return `var(${token}, ${fallback})`;
}
export {
  tokenColor
};
