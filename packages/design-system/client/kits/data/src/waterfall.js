import { finite, unique } from "./visualization.js";
function waterfallSteps(data) {
  unique(data, "Waterfall");
  let balance = 0;
  return data.map((item) => {
    const kind = item.kind ?? "delta";
    if (kind === "subtotal") return { ...item, start: 0, end: balance, amount: balance, kind };
    const value = finite(item.value ?? 0, item.id);
    if (kind === "total") {
      balance = value;
      return { ...item, start: 0, end: balance, amount: value, kind };
    }
    const start = balance;
    balance += value;
    return { ...item, start, end: balance, amount: value, kind };
  });
}
export {
  waterfallSteps
};
