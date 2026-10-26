import { Extension } from "../sdk"
import { Changes } from "../review/contract"
import en from "./i18n/en"

export default Extension.define({ id: "delivery", uses: { changes: Changes }, i18n: { en } })
