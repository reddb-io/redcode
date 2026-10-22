const CLEARSPACE_RATIO = 0.25;
const MINIMUM_SYMBOL_PX = 16;
const DEFAULT_SYMBOL_PX = 32;
class LogoTooSmallError extends Error {
  /** The symbol height that was asked for, in CSS pixels. */
  size;
  /** The floor it fell under. */
  minimum;
  constructor(size, minimum = MINIMUM_SYMBOL_PX) {
    super(
      `Logo: size=${size} would render the symbol at ${size}px, below the ${minimum}px minimum.
Minimum size is the component's physics, not its documentation (ADR 0004): there is no opt-out prop, because a legitimate exception has to be written by the Brand first.
Ask for size=${minimum} or larger, or use a layout whose symbol carries at this size.`
    );
    this.name = "LogoTooSmallError";
    this.size = size;
    this.minimum = minimum;
  }
}
function logoBox(mark, size = DEFAULT_SYMBOL_PX) {
  if (!Number.isFinite(size) || size <= 0) {
    throw new LogoTooSmallError(size);
  }
  if (size < MINIMUM_SYMBOL_PX) {
    throw new LogoTooSmallError(size);
  }
  const scale = size / mark.symbolHeight;
  const markWidth = mark.width * scale;
  const markHeight = mark.height * scale;
  const clearspace = size * CLEARSPACE_RATIO;
  return {
    symbol: size,
    clearspace,
    markWidth,
    markHeight,
    width: markWidth + clearspace * 2,
    height: markHeight + clearspace * 2
  };
}
function minimumSize() {
  return MINIMUM_SYMBOL_PX;
}
function px(length) {
  return `${Math.round(length * 1e3) / 1e3}px`;
}
export {
  CLEARSPACE_RATIO,
  DEFAULT_SYMBOL_PX,
  LogoTooSmallError,
  MINIMUM_SYMBOL_PX,
  logoBox,
  minimumSize,
  px
};
