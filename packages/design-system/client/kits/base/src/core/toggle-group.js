function toggleGroupValue(options, value) {
  return options.find((option) => !option.disabled && option.value === value)?.value ?? options.find((option) => !option.disabled)?.value ?? "";
}
function toggleGroupTarget(options, current, key, rtl = false) {
  const enabled = options.map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled);
  const position = enabled.findIndex(({ index }) => index === current);
  if (position < 0) return void 0;
  let next;
  if (key === "ArrowDown" || key === (rtl ? "ArrowLeft" : "ArrowRight")) next = (position + 1) % enabled.length;
  if (key === "ArrowUp" || key === (rtl ? "ArrowRight" : "ArrowLeft")) next = (position - 1 + enabled.length) % enabled.length;
  if (key === "Home") next = 0;
  if (key === "End") next = enabled.length - 1;
  return next === void 0 ? void 0 : enabled[next].index;
}
export {
  toggleGroupTarget,
  toggleGroupValue
};
