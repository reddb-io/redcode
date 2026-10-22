function categoryValues(active, value, checked) {
  return checked ? active.includes(value) ? [...active] : [...active, value] : active.filter((candidate) => candidate !== value);
}
export {
  categoryValues
};
