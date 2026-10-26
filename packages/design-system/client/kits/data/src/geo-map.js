import { unique, finite } from "./visualization.js";
const MAP_WIDTH = 1e3, MAP_HEIGHT = 500;
function geoPosition(longitude, latitude) {
  finite(longitude, "GeoMap longitude");
  finite(latitude, "GeoMap latitude");
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new Error("GeoMap: WGS84 coordinates are out of range");
  return [(longitude + 180) / 360 * MAP_WIDTH, (90 - latitude) / 180 * MAP_HEIGHT];
}
function geoLand(geography) {
  if (!geography) return [];
  if (geography.type !== "FeatureCollection") throw new Error("GeoMap: expected a GeoJSON FeatureCollection");
  return geography.features.flatMap((feature) => {
    const g = feature.geometry;
    if (!g) return [];
    if (g.type !== "Polygon" && g.type !== "MultiPolygon") throw new Error("GeoMap: land supports Polygon and MultiPolygon geometry");
    const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    return polygons.map((polygon) => polygon.map((ring) => {
      if (ring.length < 4) throw new Error("GeoMap: a polygon ring needs at least four positions");
      return ring.map((position, index) => {
        if (position.length < 2) throw new Error("GeoMap: incomplete GeoJSON position");
        const [x, y] = geoPosition(position[0], position[1]);
        return `${index ? "L" : "M"}${x},${y}`;
      }).join(" ") + " Z";
    }).join(" "));
  });
}
function geoData(points, routes) {
  unique(points, "GeoMap points");
  unique(routes, "GeoMap routes");
  const projected = points.map((point) => ({ ...point, position: geoPosition(point.longitude, point.latitude) }));
  const byId = new Map(projected.map((point) => [point.id, point]));
  const paths = routes.map((route) => {
    const a = byId.get(route.source), b = byId.get(route.target);
    if (!a || !b) throw new Error(`GeoMap: unknown endpoint in route ${route.id}`);
    const [x1, y1] = a.position;
    let [x2, y2] = b.position;
    if (x2 - x1 > MAP_WIDTH / 2) x2 -= MAP_WIDTH;
    if (x2 - x1 < -MAP_WIDTH / 2) x2 += MAP_WIDTH;
    const bend = Math.min(60, Math.hypot(x2 - x1, y2 - y1) * 0.15);
    const path = (shift) => `M${x1 + shift},${y1} Q${(x1 + x2) / 2 + shift},${(y1 + y2) / 2 - bend} ${x2 + shift},${y2}`;
    return { ...route, paths: [path(0), ...x2 < 0 ? [path(MAP_WIDTH)] : x2 > MAP_WIDTH ? [path(-MAP_WIDTH)] : []] };
  });
  return { points: projected, routes: paths };
}
function geoLabelIds(points, selected, scale, glyphWidth, lineHeight) {
  const boxes = [];
  const result = /* @__PURE__ */ new Set();
  const ordered = [...points.filter((p) => p.id === selected), ...points.filter((p) => p.id !== selected)];
  for (const point of ordered) {
    const x = point.position[0] * scale, y = point.position[1] * scale, w = point.label.length * glyphWidth;
    const left = point.position[0] > 800 ? x - 12 - w : x + 12;
    const box = { left, right: left + w, top: y - 10 - lineHeight, bottom: y - 10 };
    if (point.id !== selected && boxes.some((b) => box.left < b.right + glyphWidth && box.right + glyphWidth > b.left && box.top < b.bottom + glyphWidth && box.bottom + glyphWidth > b.top)) continue;
    boxes.push(box);
    result.add(point.id);
  }
  return result;
}
export {
  MAP_HEIGHT,
  MAP_WIDTH,
  geoData,
  geoLabelIds,
  geoLand,
  geoPosition
};
