function createNavigationDisclosures() {
  const closers = /* @__PURE__ */ new Set();
  return {
    register(close) {
      closers.add(close);
      return { open() {
        for (const other of closers) if (other !== close) other();
      }, destroy() {
        closers.delete(close);
      } };
    }
  };
}
export {
  createNavigationDisclosures
};
