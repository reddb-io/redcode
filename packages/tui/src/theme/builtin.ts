import aura from "./assets/builtin/aura.json" with { type: "json" }
import ayu from "./assets/builtin/ayu.json" with { type: "json" }
import carbonfox from "./assets/builtin/carbonfox.json" with { type: "json" }
import catppuccinFrappe from "./assets/builtin/catppuccin-frappe.json" with { type: "json" }
import catppuccinMacchiato from "./assets/builtin/catppuccin-macchiato.json" with { type: "json" }
import catppuccin from "./assets/builtin/catppuccin.json" with { type: "json" }
import cobalt2 from "./assets/builtin/cobalt2.json" with { type: "json" }
import cursor from "./assets/builtin/cursor.json" with { type: "json" }
import dracula from "./assets/builtin/dracula.json" with { type: "json" }
import everforest from "./assets/builtin/everforest.json" with { type: "json" }
import flexoki from "./assets/builtin/flexoki.json" with { type: "json" }
import github from "./assets/builtin/github.json" with { type: "json" }
import gruvbox from "./assets/builtin/gruvbox.json" with { type: "json" }
import kanagawa from "./assets/builtin/kanagawa.json" with { type: "json" }
import lucentOrng from "./assets/builtin/lucent-orng.json" with { type: "json" }
import material from "./assets/builtin/material.json" with { type: "json" }
import matrix from "./assets/builtin/matrix.json" with { type: "json" }
import mercury from "./assets/builtin/mercury.json" with { type: "json" }
import monokai from "./assets/builtin/monokai.json" with { type: "json" }
import nightowl from "./assets/builtin/nightowl.json" with { type: "json" }
import nord from "./assets/builtin/nord.json" with { type: "json" }
import onedark from "./assets/builtin/one-dark.json" with { type: "json" }
import orng from "./assets/builtin/orng.json" with { type: "json" }
import osakaJade from "./assets/builtin/osaka-jade.json" with { type: "json" }
import palenight from "./assets/builtin/palenight.json" with { type: "json" }
import rosepine from "./assets/builtin/rosepine.json" with { type: "json" }
import solarized from "./assets/builtin/solarized.json" with { type: "json" }
import synthwave84 from "./assets/builtin/synthwave84.json" with { type: "json" }
import tokyonight from "./assets/builtin/tokyonight.json" with { type: "json" }
import vercel from "./assets/builtin/vercel.json" with { type: "json" }
import vesper from "./assets/builtin/vesper.json" with { type: "json" }
import zenburn from "./assets/builtin/zenburn.json" with { type: "json" }

export const DEFAULT_THEMES: Record<string, Record<string, unknown>> = {
  aura,
  ayu,
  catppuccin,
  ["catppuccin-frappe"]: catppuccinFrappe,
  ["catppuccin-macchiato"]: catppuccinMacchiato,
  cobalt2,
  cursor,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  ["one-dark"]: onedark,
  ["osaka-jade"]: osakaJade,
  orng,
  ["lucent-orng"]: lucentOrng,
  palenight,
  rosepine,
  solarized,
  synthwave84,
  tokyonight,
  vesper,
  vercel,
  zenburn,
  carbonfox,
}
