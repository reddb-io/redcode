function readSelectValue(element) {
  return element.multiple ? Array.from(element.selectedOptions, (option) => option.value) : element.value;
}
function writeSelectValue(element, value) {
  const values = new Set((Array.isArray(value) ? value : [value]).map(String));
  let matched = false;
  for (const option of element.options) {
    const selected = values.has(option.value) && (element.multiple || !matched);
    option.selected = selected;
    matched ||= selected;
  }
  if (!matched && !element.multiple) element.selectedIndex = -1;
}
export {
  readSelectValue,
  writeSelectValue
};
