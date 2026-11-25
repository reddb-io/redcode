import { jsx } from "react/jsx-runtime";
import { useEffect } from "react";
import { warnDeprecated } from "@reddb-io/design-system/base";
import { DataTable } from "./DataTable.js";
export * from "../../src/table.js";
function Table(props) {
  useEffect(() => warnDeprecated("Table", "@reddb-io/design-system/data/Table", "@reddb-io/design-system/data/DataTable"), []);
  return /* @__PURE__ */ jsx(DataTable, { ...props });
}
var Table_default = Table;
export {
  Table,
  Table_default as default
};
