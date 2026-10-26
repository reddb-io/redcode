import { unique } from "./visualization.js";
function explodedLayers(data) {
  unique(data, "Exploded layers");
  return data.map((layer, index) => ({
    ...layer,
    series: layer.series ?? index % 6 + 1
  }));
}
function explodedLayout(data, width, height, unit = 32) {
  const drawingWidth = Math.min(width, height * 2);
  const offset = (width - drawingWidth) / 2;
  const cx = offset + drawingWidth * 0.32;
  const inset = Math.min(unit * 0.625, height * 0.05);
  const thickness = Math.min(unit * 0.5, height * 0.05);
  const half = Math.min(drawingWidth * 0.26, (height - inset * 2 - thickness) / (1 + Math.max(0, data.length - 1) * 0.625));
  const depth = half * 0.5;
  const step = data.length > 1 ? (height - inset * 2 - depth * 2 - thickness) / (data.length - 1) : 0;
  const rx = Math.min(unit * 0.5, half * 0.08);
  const ry = rx * depth / half;
  const labelX = offset + drawingWidth * 0.67;
  const labelWidth = offset + drawingWidth - labelX - inset;
  return data.map((layer, index) => {
    const cy = data.length > 1 ? inset + depth + index * step : (height - thickness) / 2;
    const left = cx - half, right = cx + half;
    const top = `M${cx - rx},${cy - depth + ry} Q${cx},${cy - depth} ${cx + rx},${cy - depth + ry} L${right - rx},${cy - ry} Q${right},${cy} ${right - rx},${cy + ry} L${cx + rx},${cy + depth - ry} Q${cx},${cy + depth} ${cx - rx},${cy + depth - ry} L${left + rx},${cy + ry} Q${left},${cy} ${left + rx},${cy - ry} Z`;
    const leftTip = left + rx / 2, rightTip = right - rx / 2;
    const frontY = cy + depth - ry / 2;
    const leftFace = `M${leftTip},${cy} Q${leftTip},${cy + ry / 2} ${left + rx},${cy + ry} L${cx - rx},${cy + depth - ry} Q${cx - rx / 2},${frontY} ${cx},${frontY} V${frontY + thickness} Q${cx - rx / 2},${frontY + thickness} ${cx - rx},${cy + depth + thickness - ry} L${left + rx},${cy + thickness + ry} Q${leftTip},${cy + thickness + ry / 2} ${leftTip},${cy + thickness} Z`;
    const rightFace = `M${cx},${frontY} Q${cx + rx / 2},${frontY} ${cx + rx},${cy + depth - ry} L${right - rx},${cy + ry} Q${rightTip},${cy + ry / 2} ${rightTip},${cy} V${cy + thickness} Q${rightTip},${cy + thickness + ry / 2} ${right - rx},${cy + thickness + ry} L${cx + rx},${cy + depth + thickness - ry} Q${cx + rx / 2},${frontY + thickness} ${cx},${frontY + thickness} Z`;
    const front = `M${leftTip},${cy} Q${leftTip},${cy + ry / 2} ${left + rx},${cy + ry} L${cx - rx},${cy + depth - ry} Q${cx},${cy + depth} ${cx + rx},${cy + depth - ry} L${right - rx},${cy + ry} Q${rightTip},${cy + ry / 2} ${rightTip},${cy} V${cy + thickness} Q${rightTip},${cy + thickness + ry / 2} ${right - rx},${cy + thickness + ry} L${cx + rx},${cy + depth + thickness - ry} Q${cx},${cy + depth + thickness} ${cx - rx},${cy + depth + thickness - ry} L${left + rx},${cy + thickness + ry} Q${leftTip},${cy + thickness + ry / 2} ${leftTip},${cy + thickness} Z`;
    return { ...layer, index, cy, left: leftTip, right: rightTip, depth, thickness, top, leftFace, rightFace, front, labelX, labelWidth };
  });
}
function layerLines(text, columns) {
  const lines = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].length + word.length + 1 <= columns) lines[last] += ` ${word}`;
    else {
      for (let start = 0; start < word.length; start += columns) lines.push(word.slice(start, start + columns));
    }
  }
  return lines;
}
export {
  explodedLayers,
  explodedLayout,
  layerLines
};
