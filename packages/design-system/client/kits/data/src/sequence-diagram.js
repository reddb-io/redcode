import { unique } from "./visualization.js";
function sequenceData(data) {
  unique(data.participants, "Sequence participants");
  unique(data.messages, "Sequence messages");
  const ids = new Set(data.participants.map((p) => p.id));
  for (const m of data.messages) if (!ids.has(m.source) || !ids.has(m.target)) throw new Error("Unknown sequence participant");
  return data;
}
export {
  sequenceData
};
