import { jsx } from "react/jsx-runtime";
import { Card } from "./Card.js";
function ListContainer({ variant = "outline", padding = "md", title, description, header, footer, className, children, ...rest }) {
  return /* @__PURE__ */ jsx(Card, { ...rest, "data-list-container": true, variant, padding, title, description, header, footer, className, children });
}
export {
  ListContainer
};
