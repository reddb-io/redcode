import { tv } from "tailwind-variants";
const commandPalette = tv({
  slots: {
    root: "isolate min-w-0 text-foreground",
    content: [
      "w-[min(32rem,calc(100vw-2rem))]",
      "p-[var(--reddb-spatial-inset-md)]"
    ].join(" "),
    search: "min-w-0"
  }
});
export {
  commandPalette
};
