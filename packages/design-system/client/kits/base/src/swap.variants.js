import { tv } from "tailwind-variants";
const swap = tv({
  base: "inline-grid place-items-center"
});
const swapFace = tv({
  base: "inline-flex items-center justify-center gap-[var(--reddb-spatial-gap-md)]"
});
export {
  swap,
  swapFace
};
