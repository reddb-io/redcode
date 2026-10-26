import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
function renderStaticVisualization(component, props) {
  return renderToStaticMarkup(
    createElement(component, { ...props, interactive: false })
  );
}
export {
  renderStaticVisualization
};
