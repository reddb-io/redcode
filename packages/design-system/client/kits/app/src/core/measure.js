function observeElementSize(element, changed) {
  if (!element) return () => {
  };
  const measure = () => changed(element.getBoundingClientRect());
  measure();
  if (typeof ResizeObserver === "undefined") return () => {
  };
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  return () => observer.disconnect();
}
export {
  observeElementSize
};
