import { modalFocusable } from "./modal.js";
function trapScopeTab(scope) {
  const keydown = (event) => {
    if (event.defaultPrevented || event.key !== "Tab" || !(event.target instanceof Element) || event.target.closest("[data-ds-focus-scope]") !== scope) return;
    const nodes = [...scope.querySelectorAll(modalFocusable)].filter((element) => !element.closest("[hidden],[inert]") && !element.matches(":disabled") && element.tabIndex >= 0 && getComputedStyle(element).display !== "none");
    const first = nodes[0], last = nodes.at(-1);
    if (!first || !last) {
      event.preventDefault();
      scope.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  scope.addEventListener("keydown", keydown, true);
  return () => scope.removeEventListener("keydown", keydown, true);
}
export {
  trapScopeTab
};
