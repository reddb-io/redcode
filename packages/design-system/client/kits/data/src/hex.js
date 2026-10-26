function hexBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (value instanceof Uint8Array) return value.slice();
  for (const byte of value) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new RangeError(`Hex bytes must be integers from 0 to 255; received ${byte}.`);
    }
  }
  return Uint8Array.from(value);
}
function formatHex(value, bytesPerRow = 16) {
  if (!Number.isInteger(bytesPerRow) || bytesPerRow < 1) {
    throw new RangeError("bytesPerRow must be a positive integer.");
  }
  const bytes = hexBytes(value);
  const offsetWidth = Math.max(8, Math.max(0, bytes.length - 1).toString(16).length);
  const hexWidth = bytesPerRow * 3 - 1;
  const rows = [];
  for (let offset = 0; offset < bytes.length; offset += bytesPerRow) {
    const row = bytes.slice(offset, offset + bytesPerRow);
    const hex = [...row].map((byte) => byte.toString(16).padStart(2, "0")).join(" ").padEnd(hexWidth, " ");
    const ascii = [...row].map((byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".").join("").padEnd(bytesPerRow, " ");
    rows.push({
      offset: offset.toString(16).padStart(offsetWidth, "0"),
      hex,
      ascii
    });
  }
  return rows;
}
export {
  formatHex,
  hexBytes
};
