import { Browser } from "../browser/contract"
import { Extension } from "../sdk"
import en from "./i18n/en"

export default Extension.define({
  id: "design",
  // On the desktop the review opens beside the session in the browser pane; without it, in a system browser.
  uses: { browser: Browser },
  i18n: {
    en,
    br: () => import("./i18n/br"),
  },
})
