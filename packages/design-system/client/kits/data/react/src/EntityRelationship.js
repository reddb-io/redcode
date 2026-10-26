"use client";
import { Fragment, jsx } from "react/jsx-runtime";
import { useControllableValue } from "@reddb-io/design-system/base";
import Plot from "./SchemaPlot.js";
function EntityRelationship(props) {
  const {
    data,
    fieldLimit = 8,
    label = "Entity relationships",
    description,
    width,
    height,
    size,
    selected: initialSelected = "",
    onSelectedChange,
    interactive = true,
    detailHref,
    className = ""
  } = props;
  const [selected, setSelected] = useControllableValue(
    props.selected,
    initialSelected,
    props.onSelectedChange
  );
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Plot,
    {
      kind: "EntityRelationship",
      data,
      fieldLimit,
      label,
      description,
      width,
      height,
      size,
      selected,
      onSelectedChange: setSelected,
      interactive,
      detailHref,
      className
    }
  ) });
}
var EntityRelationship_default = EntityRelationship;
export {
  EntityRelationship,
  EntityRelationship_default as default
};
