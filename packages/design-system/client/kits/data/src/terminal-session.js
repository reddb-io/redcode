function terminalAppearance(element, reducedMotion) {
  const style = getComputedStyle(element);
  const fontSize = Number.parseFloat(style.fontSize);
  const probe = document.createElement("span");
  probe.hidden = true;
  element.append(probe);
  const roles = {
    black: "ink-muted",
    red: "feedback-danger-foreground",
    green: "feedback-success-foreground",
    yellow: "feedback-warning-foreground",
    blue: "feedback-info-foreground",
    magenta: "series-4",
    cyan: "series-3",
    white: "foreground"
  };
  const palette = Object.fromEntries(Object.entries(roles).map(([name, role]) => {
    probe.style.color = `var(--reddb-color-${role})`;
    return [name, getComputedStyle(probe).color];
  }));
  probe.remove();
  return {
    background: style.backgroundColor,
    foreground: style.color,
    fontFamily: style.fontFamily,
    fontSize,
    lineHeight: Number.parseFloat(style.lineHeight) / fontSize || 1,
    reducedMotion,
    palette
  };
}
export {
  terminalAppearance
};
