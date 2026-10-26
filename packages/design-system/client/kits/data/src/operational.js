function uniqueEntities(items, name) {
  const ids = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (!item.id || ids.has(item.id))
      throw new Error(`${name}: ids must be non-empty and unique`);
    ids.add(item.id);
  }
  return items;
}
function retainedEvents(events, limit, query) {
  uniqueEntities(events, "EventLog");
  const bound = Math.min(
    1e4,
    Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 200))
  );
  const retained = events.slice(-bound), search = query.toLocaleLowerCase();
  return {
    discarded: Math.max(0, events.length - bound),
    events: search ? retained.filter(
      (e) => `${e.source ?? ""} ${e.message}`.toLocaleLowerCase().includes(search)
    ) : retained
  };
}
function followEvents(element, onPause) {
  let following = false;
  const userScroll = () => {
    if (following && element.scrollHeight - element.clientHeight - element.scrollTop > 4) {
      following = false;
      onPause();
    }
  };
  const stopOnNavigation = (event) => {
    if (following && (event instanceof KeyboardEvent ? ["ArrowUp", "PageUp", "Home"].includes(event.key) : true)) {
      following = false;
      onPause();
    }
  };
  element.addEventListener("scroll", userScroll);
  element.addEventListener("wheel", stopOnNavigation, { passive: true });
  element.addEventListener("touchstart", stopOnNavigation, { passive: true });
  element.addEventListener("keydown", stopOnNavigation);
  return {
    update(enabled) {
      following = enabled;
      if (enabled) element.scrollTop = element.scrollHeight;
    },
    destroy() {
      element.removeEventListener("scroll", userScroll);
      element.removeEventListener("wheel", stopOnNavigation);
      element.removeEventListener("touchstart", stopOnNavigation);
      element.removeEventListener("keydown", stopOnNavigation);
    }
  };
}
function stateCellWidth(value) {
  return Math.max(8, Math.min(40, Number.isFinite(value) ? value : 12));
}
function operationalToneInk(tone) {
  return tone && tone !== "neutral" ? `var(--reddb-color-feedback-${tone}-foreground)` : void 0;
}
export {
  followEvents,
  operationalToneInk,
  retainedEvents,
  stateCellWidth,
  uniqueEntities
};
