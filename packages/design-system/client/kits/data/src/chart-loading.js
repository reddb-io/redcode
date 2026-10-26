const CHART_LOAD_MARGIN = "320px";
function whenNear(element, near) {
  if (typeof IntersectionObserver === "undefined") {
    near();
    return () => {
    };
  }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    near();
  }, { rootMargin: CHART_LOAD_MARGIN });
  observer.observe(element);
  return () => observer.disconnect();
}
export {
  CHART_LOAD_MARGIN,
  whenNear
};
