function inputValue(input) {
  return input.type === "number" || input.type === "range" ? input.value === "" ? null : input.valueAsNumber : input.value;
}
export {
  inputValue
};
