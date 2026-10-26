function sceneAnnotations(items) {
  const ids = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (!item.id.trim() || ids.has(item.id) || ![item.x, item.y].every(Number.isFinite))
      throw new Error(
        "SceneViewport: annotations require unique ids and finite anchors"
      );
    ids.add(item.id);
  }
  return items;
}
function projectAnnotation(point, view, box, label) {
  const x = view.x + point.x * view.scale, y = view.y + point.y * view.scale;
  return {
    x: Math.max(0, Math.min(box.width - label.width, x - label.width / 2)),
    y: Math.max(0, Math.min(box.height - label.height, y - label.height)),
    visible: x >= 0 && x <= box.width && y >= 0 && y <= box.height
  };
}
function mountSceneAnnotations(host) {
  let view = { x: 0, y: 0, scale: 1 };
  const viewport = host.querySelector(
    "[data-pan-zoom] [role=region]"
  );
  const layout = () => {
    if (!viewport) return;
    const box = { width: viewport.clientWidth, height: viewport.clientHeight };
    const occupied = [];
    const labels = [
      ...viewport.querySelectorAll("[data-scene-annotation]")
    ];
    labels.sort(
      (a, b) => Number(b.contains(b.ownerDocument.activeElement)) - Number(a.contains(a.ownerDocument.activeElement)) || Number(b.dataset.selected === "true") - Number(a.dataset.selected === "true")
    );
    for (const node of labels) {
      node.hidden = false;
      const size = { width: node.offsetWidth, height: node.offsetHeight };
      const position = projectAnnotation(
        { x: Number(node.dataset.x), y: Number(node.dataset.y) },
        view,
        box,
        size
      );
      const collision = occupied.some(
        (other) => position.x < other.x + other.width && position.x + size.width > other.x && position.y < other.y + other.height && position.y + size.height > other.y
      );
      node.hidden = (!position.visible || collision) && !node.contains(node.ownerDocument.activeElement);
      node.style.left = `${position.x}px`;
      node.style.top = `${position.y}px`;
      if (!node.hidden) occupied.push({ ...position, ...size });
    }
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(layout) : void 0;
  if (viewport) observer?.observe(viewport);
  const observed = /* @__PURE__ */ new Set();
  function observeLabels() {
    const current = new Set(
      host.querySelectorAll("[data-scene-annotation]")
    );
    for (const node of observed)
      if (!current.has(node)) {
        observer?.unobserve(node);
        observed.delete(node);
      }
    for (const node of current)
      if (!observed.has(node)) {
        observer?.observe(node);
        observed.add(node);
      }
  }
  observeLabels();
  return {
    update(next) {
      view = next;
      observeLabels();
      layout();
    },
    destroy() {
      observer?.disconnect();
    }
  };
}
export {
  mountSceneAnnotations,
  projectAnnotation,
  sceneAnnotations
};
