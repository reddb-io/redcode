const DEFAULT_BUNDLE_OPTIONS = {
  stiffness: 0.1,
  stepSize: 0.1,
  cycles: 6,
  iterations: 60,
  iterationRate: 2 / 3,
  subdivisionRate: 2,
  compatibilityThreshold: 0.6
};
const BUNDLE_EDGE_LIMIT = 1500;
const EPS = 1e-6;
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function midpoint(s, t) {
  return { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
}
function resample(points, interior) {
  if (!points.length) return [];
  const count = interior + 2;
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + distance(points[i], points[i - 1]));
  }
  const total = cum[cum.length - 1];
  if (total < EPS) {
    return Array.from({ length: count }, () => ({ ...points[0] }));
  }
  const out = [];
  let seg = 1;
  for (let k = 0; k < count; k++) {
    const target = total * k / (count - 1);
    while (seg < points.length - 1 && cum[seg] < target) seg++;
    const t0 = cum[seg - 1];
    const span = cum[seg] - t0 || 1;
    const pct = Math.max(0, Math.min(1, (target - t0) / span));
    out.push({
      x: points[seg - 1].x + pct * (points[seg].x - points[seg - 1].x),
      y: points[seg - 1].y + pct * (points[seg].y - points[seg - 1].y)
    });
  }
  return out;
}
function angleCompatibility(p, q) {
  const dot = (p.t.x - p.s.x) * (q.t.x - q.s.x) + (p.t.y - p.s.y) * (q.t.y - q.s.y);
  return Math.abs(dot / (p.len * q.len));
}
function scaleCompatibility(p, q) {
  const lavg = (p.len + q.len) / 2;
  return 2 / (lavg / Math.min(p.len, q.len) + Math.max(p.len, q.len) / lavg);
}
function positionCompatibility(p, q) {
  const lavg = (p.len + q.len) / 2;
  return lavg / (lavg + distance(midpoint(p.s, p.t), midpoint(q.s, q.t)));
}
function projectOntoLine(point, line) {
  const l2 = line.len * line.len;
  const r = ((line.s.y - point.y) * (line.s.y - line.t.y) - (line.s.x - point.x) * (line.t.x - line.s.x)) / l2;
  return {
    x: line.s.x + r * (line.t.x - line.s.x),
    y: line.s.y + r * (line.t.y - line.s.y)
  };
}
function edgeVisibility(p, q) {
  const i0 = projectOntoLine(q.s, p);
  const i1 = projectOntoLine(q.t, p);
  const im = midpoint(i0, i1);
  const denom = distance(i0, i1);
  if (denom < EPS) return 0;
  return Math.max(0, 1 - 2 * distance(im, midpoint(q.s, q.t)) / denom);
}
function visibilityCompatibility(p, q) {
  return Math.min(edgeVisibility(p, q), edgeVisibility(q, p));
}
function compatibilityScore(p, q) {
  return angleCompatibility(p, q) * scaleCompatibility(p, q) * positionCompatibility(p, q) * visibilityCompatibility(p, q);
}
function compatibilityLists(segments, threshold) {
  const lists = segments.map(() => []);
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (compatibilityScore(segments[i], segments[j]) >= threshold) {
        lists[i].push(j);
        lists[j].push(i);
      }
    }
  }
  return lists;
}
function bundleEdges(nodes, edges, options = {}) {
  const opts = { ...DEFAULT_BUNDLE_OPTIONS, ...options };
  for (const key of Object.keys(opts)) {
    if (!Number.isFinite(opts[key]) || opts[key] <= 0)
      opts[key] = DEFAULT_BUNDLE_OPTIONS[key];
  }
  opts.cycles = Math.min(6, Math.floor(opts.cycles));
  opts.iterations = Math.min(100, Math.floor(opts.iterations));
  opts.subdivisionRate = Math.max(
    1,
    Math.min(2, Math.floor(opts.subdivisionRate))
  );
  opts.iterationRate = Math.min(1, opts.iterationRate);
  const pos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const result = /* @__PURE__ */ new Map();
  const segments = [];
  for (const e of edges) {
    const s = pos.get(e.source);
    const t = pos.get(e.target);
    if (!s || !t) continue;
    result.set(e.id, [{ ...s }, { ...t }]);
    if (e.source === e.target) continue;
    const len = distance(s, t);
    if (len < EPS) continue;
    segments.push({ id: e.id, s: { ...s }, t: { ...t }, len });
  }
  if (segments.length < 2 || edges.length > BUNDLE_EDGE_LIMIT) return result;
  const subdivisions = segments.map((seg) => [
    { ...seg.s },
    { ...seg.t }
  ]);
  const compat = compatibilityLists(segments, opts.compatibilityThreshold);
  let p = 1;
  let step = opts.stepSize;
  let iterations = opts.iterations;
  for (let i = 0; i < subdivisions.length; i++) {
    subdivisions[i] = resample(subdivisions[i], p);
  }
  for (let cycle = 0; cycle < opts.cycles; cycle++) {
    const rounds = Math.max(1, Math.round(iterations));
    for (let iter = 0; iter < rounds; iter++) {
      const forces = segments.map(
        (_, ei) => computeForces(
          ei,
          subdivisions,
          compat,
          segments[ei].len,
          p,
          step,
          opts.stiffness
        )
      );
      for (let ei = 0; ei < segments.length; ei++) {
        for (let i = 1; i <= p; i++) {
          subdivisions[ei][i].x += forces[ei][i].x;
          subdivisions[ei][i].y += forces[ei][i].y;
        }
      }
    }
    step *= 0.5;
    p *= opts.subdivisionRate;
    iterations *= opts.iterationRate;
    for (let i = 0; i < subdivisions.length; i++) {
      subdivisions[i] = resample(subdivisions[i], p);
    }
  }
  for (let ei = 0; ei < segments.length; ei++) {
    result.set(
      segments[ei].id,
      subdivisions[ei].map((pt) => ({ x: pt.x, y: pt.y }))
    );
  }
  return result;
}
function computeForces(ei, subdivisions, compat, edgeLen, p, step, stiffness) {
  const kp = stiffness / (edgeLen * (p + 1));
  const points = subdivisions[ei];
  const forces = [{ x: 0, y: 0 }];
  for (let i = 1; i <= p; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    let fx = kp * (prev.x - 2 * cur.x + next.x);
    let fy = kp * (prev.y - 2 * cur.y + next.y);
    for (const oe of compat[ei]) {
      const other = subdivisions[oe][i];
      const dx = other.x - cur.x;
      const dy = other.y - cur.y;
      if (Math.abs(dx) > EPS || Math.abs(dy) > EPS) {
        const d = Math.hypot(dx, dy);
        fx += dx / d;
        fy += dy / d;
      }
    }
    forces.push({ x: step * fx, y: step * fy });
  }
  forces.push({ x: 0, y: 0 });
  return forces;
}
function edgeCurvature(points) {
  if (points.length < 3) return 0;
  const s = points[0];
  const t = points[points.length - 1];
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return 0;
  let maxDev = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const px = points[i].x - s.x;
    const py = points[i].y - s.y;
    const dev = (px * -dy + py * dx) / len;
    if (Math.abs(dev) > Math.abs(maxDev)) maxDev = dev;
  }
  const curvature = 2 * maxDev / len;
  return Math.max(-1, Math.min(1, curvature));
}
function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function segmentsCross(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return (d1 > 0 && d2 < 0 || d1 < 0 && d2 > 0) && (d3 > 0 && d4 < 0 || d3 < 0 && d4 > 0);
}
function countEdgeCrossings(polylines) {
  let crossings = 0;
  for (let a = 0; a < polylines.length; a++) {
    const A = polylines[a];
    for (let b = a + 1; b < polylines.length; b++) {
      const B = polylines[b];
      for (let i = 1; i < A.length; i++) {
        for (let j = 1; j < B.length; j++) {
          if (segmentsCross(A[i - 1], A[i], B[j - 1], B[j])) crossings++;
        }
      }
    }
  }
  return crossings;
}
function edgeInk(polylines, cellSize) {
  if (!Number.isFinite(cellSize) || cellSize <= 0)
    throw new Error("cellSize must be positive and finite.");
  const cells = /* @__PURE__ */ new Set();
  const half = cellSize / 2;
  for (const poly of polylines) {
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1];
      const b = poly[i];
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / half)
      );
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const x = Math.floor((a.x + u * (b.x - a.x)) / cellSize);
        const y = Math.floor((a.y + u * (b.y - a.y)) / cellSize);
        cells.add(`${x},${y}`);
      }
    }
  }
  return cells.size;
}
export {
  BUNDLE_EDGE_LIMIT,
  DEFAULT_BUNDLE_OPTIONS,
  bundleEdges,
  countEdgeCrossings,
  edgeCurvature,
  edgeInk
};
