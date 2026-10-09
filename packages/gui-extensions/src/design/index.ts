import { Extension } from "../sdk"
import en from "./i18n/en"

export default Extension.define({
  id: "design",
  i18n: {
    en,
    br: () => import("./i18n/br"),
  },
})
