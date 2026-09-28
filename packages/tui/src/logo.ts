import { redcode } from "@opencode/util/product"

const redcodeLogo = {
  left: ["               ", "█▀█ █▀▀ █▀▄    ", "█▀▄ █▀▀ █ █    ", "▀ ▀ ▀▀▀ ▀▀     "],
  right: ["                 ", "█▀▀ █▀█ █▀▄ █▀▀", "█   █ █ █ █ █▀▀", "▀▀▀ ▀▀▀ ▀▀  ▀▀▀"],
}

export const logo = {
  left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
}

export const productLogo = redcode ? redcodeLogo : logo

export const go = redcode
  ? { left: ["    ", "█▀█ ", "█▀▄ ", "▀ ▀ "], right: ["    ", "█▀█ ", "█▀▄ ", "▀ ▀ "] }
  : { left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"], right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"] }
