function secretIsVisible(options) {
  return !!options.revealable && !!options.revealed && !options.pending && !options.error && options.value != null;
}
function createSecretExposure(read, publish) {
  let timer;
  let visible = false, blocked = false, observed = false;
  let previousValue;
  const clear = () => {
    clearTimeout(timer);
    timer = void 0;
  };
  const hide = (reason) => {
    clear();
    blocked = true;
    const was = visible;
    visible = false;
    publish(false);
    if (was || reason === "control") read().onrevealedchange?.(false, reason);
  };
  return {
    sync() {
      const options = read();
      if (!options.revealed) blocked = false;
      if (visible && previousValue !== options.value) {
        hide("value-change");
        previousValue = options.value;
        return;
      }
      const next = secretIsVisible(options) && !blocked;
      if (visible && !next) {
        hide("unavailable");
        previousValue = options.value;
        observed = !!options.revealed;
        return;
      }
      if (options.revealed && !observed) blocked = false;
      observed = !!options.revealed;
      if (next && !visible) {
        clear();
        const lifetime = Number.isFinite(options.hideAfter ?? 3e4) ? Math.max(0, options.hideAfter ?? 3e4) : 3e4;
        if (lifetime > 0) timer = setTimeout(() => hide("timeout"), lifetime);
      }
      visible = next;
      previousValue = options.value;
      publish(next);
    },
    matches(value) {
      return visible && value === previousValue;
    },
    request(next) {
      if (!next) hide("control");
      else if (read().revealable && !read().pending)
        read().onrevealedchange?.(true, "control");
    },
    hide,
    destroy() {
      clear();
    }
  };
}
export {
  createSecretExposure,
  secretIsVisible
};
