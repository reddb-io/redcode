async function copyCodeSource(code) {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    return false;
  }
}
function observeCodeOverflow(element, changed) {
  const measure = () => changed(element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);
  measure();
  if (typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  if (element.firstElementChild) observer.observe(element.firstElementChild);
  return () => observer.disconnect();
}
export {
  copyCodeSource,
  observeCodeOverflow
};
