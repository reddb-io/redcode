import { Extension } from "../sdk"
import en from "./i18n/en"

export default Extension.define({
  // Imports sessions from other coding agents' local history through the server, which lists the sources it reads.
  id: "import",
  i18n: {
    en,
  },
})
