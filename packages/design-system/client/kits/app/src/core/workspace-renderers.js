class WorkspaceRendererRegistry {
  renderers = [];
  /** Register or replace a capability without changing its precedence. */
  register(renderer) {
    const index = this.renderers.findIndex((item) => item.capability === renderer.capability);
    if (index >= 0) this.renderers[index] = renderer;
    else this.renderers.push(renderer);
  }
  /** Remove a registered capability. */
  unregister(capability) {
    this.renderers = this.renderers.filter((item) => item.capability !== capability);
  }
  /** Remove all registrations from this registry. */
  clear() {
    this.renderers = [];
  }
  /** List registrations in matching precedence order. */
  list() {
    return this.renderers;
  }
  /** Check whether a capability is registered. */
  has(capability) {
    return this.renderers.some((item) => item.capability === capability);
  }
  /** Select override, compatible hint, first matching shape, then fallback. */
  resolve(hint, result, override, fallback) {
    if (override) {
      const forced = this.renderers.find((item) => item.capability === override);
      if (forced) return forced;
    }
    if (hint) {
      const preferred = this.renderers.find((item) => item.capability === hint);
      if (preferred?.renders(result)) return preferred;
    }
    return this.renderers.find((item) => item.renders(result)) ?? this.renderers.find((item) => item.capability === fallback);
  }
}
export {
  WorkspaceRendererRegistry
};
