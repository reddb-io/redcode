import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { configureVault } from "./configure"

export default Runtime.handler(Commands.commands.vault.commands.enable, (input) =>
  configureVault({ enabled: true, global: input.global }),
)
