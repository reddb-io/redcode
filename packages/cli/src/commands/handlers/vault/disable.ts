import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { configureVault } from "./configure"

export default Runtime.handler(Commands.commands.vault.commands.disable, (input) =>
  configureVault({ enabled: false, global: input.global }),
)
