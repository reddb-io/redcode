import { jsx } from "react/jsx-runtime";
import { useEffect } from "react";
import { warnDeprecated } from "@reddb-io/design-system/base";
import { RecordDiff } from "./RecordDiff.js";
import { diffFields, diffLines, formatDiffValue } from "../../src/diff.js";
function Diff(props) {
  useEffect(() => warnDeprecated("Diff", "@reddb-io/design-system/data/Diff", "@reddb-io/design-system/data/RecordDiff"), []);
  return /* @__PURE__ */ jsx(RecordDiff, { ...props });
}
var Diff_default = Diff;
export {
  Diff,
  Diff_default as default,
  diffFields,
  diffLines,
  formatDiffValue
};
